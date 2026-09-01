import * as repo from '../repositories/dashboardRepo'
import { RequerimientoFleet } from '../repositories/dashboardRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import * as pendientesRepo from '../repositories/pendientesRepo'
import * as garantiasService from './garantiasService'
import * as programaVehiculoService from './programaVehiculoService'
import { getPool } from '../shared/db'
import { parseVigencia, DIAS_ALERTA_LICENCIA } from '../shared/vigenciaLicencia'
import { fechaMexico } from '../shared/fechaMexico'
import { parseIntervalosIniciales, intervaloKmVigente } from '../shared/intervalos'
import type { Rango } from '../shared/rangoReporte'

function partesMexico(d: Date = new Date()): { year: number; month: number; day: number } {
  const [year, month, day] = fechaMexico(d).split('-').map(Number)
  return { year, month, day }
}

// Ancla el "ahora" de México a mediodía para poder leerlo de vuelta con
// getFullYear()/getMonth() sin que el desfase UTC lo recorra a otro día.
function fechaMexicoComoDate(d: Date = new Date()): Date {
  return new Date(`${fechaMexico(d)}T12:00:00`)
}

function sumarMeses(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta
  const m = ((total % 12) + 12) % 12
  return { year: (total - m) / 12, month: m + 1 }
}

function addDias(fechaYMD: string, dias: number): string {
  const d = new Date(`${fechaYMD}T12:00:00`)
  d.setDate(d.getDate() + dias)
  return fechaMexico(d)
}

// Lunes de la semana que contiene `d`, como fecha calendario de México.
function inicioSemanaMexico(d: Date = new Date()): string {
  const hoy = fechaMexico(d)
  const dow = fechaMexicoComoDate(d).getDay() // 0=domingo..6=sábado
  const diffToMonday = (dow + 6) % 7
  return addDias(hoy, -diffToMonday)
}

// La ventana inmediatamente anterior a `r`: contra un año se compara el año
// previo, contra una quincena la quincena previa.
//
// Los años y los meses se detectan aparte en vez de restar días, porque no
// todos duran lo mismo: 2024 tiene 366 días, así que "los 365 días antes de
// 2025" arrancaría el 2 de enero de 2024 y la comparación quedaría corrida un
// día. Un año se compara contra el año, no contra una cantidad de días.
function ventanaPrevia(r: Rango): Rango {
  const [ai, mi, di] = r.start.split('-').map(Number)
  const [af, mf, df] = r.end.split('-').map(Number)

  // Año calendario exacto: del 1 de enero al 1 de enero siguiente.
  if (di === 1 && mi === 1 && df === 1 && mf === 1 && af === ai + 1) {
    return { start: `${ai - 1}-01-01`, end: `${ai}-01-01` }
  }

  // Mes calendario exacto: del día 1 al día 1 del mes siguiente.
  const pad = (n: number) => String(n).padStart(2, '0')
  if (di === 1 && df === 1 && ai * 12 + mi + 1 === af * 12 + mf) {
    const previo = sumarMeses(ai, mi, -1)
    return {
      start: `${previo.year}-${pad(previo.month)}-01`,
      end:   `${ai}-${pad(mi)}-01`,
    }
  }

  const dias = Math.round(
    (new Date(`${r.end}T12:00:00`).getTime() - new Date(`${r.start}T12:00:00`).getTime()) / 86_400_000
  )
  return { start: addDias(r.start, -dias), end: r.start }
}

// Rango actual y anterior según el periodo elegido, ambos como [start, end).
function rangoActualYAnterior(periodo: 'mes' | 'semana'): { actual: Rango; anterior: Rango } {
  if (periodo === 'semana') {
    const inicioActual = inicioSemanaMexico()
    return {
      actual:   { start: inicioActual, end: addDias(inicioActual, 7) },
      anterior: { start: addDias(inicioActual, -7), end: inicioActual },
    }
  }
  const { year, month } = partesMexico()
  const pad = (n: number) => String(n).padStart(2, '0')
  const sig = sumarMeses(year, month, 1)
  const ant = sumarMeses(year, month, -1)
  return {
    actual:   { start: `${year}-${pad(month)}-01`,       end: `${sig.year}-${pad(sig.month)}-01` },
    anterior: { start: `${ant.year}-${pad(ant.month)}-01`, end: `${year}-${pad(month)}-01` },
  }
}

// Cierra las incidencias cuyo mantenimiento ya ocurrió y registra el snapshot de
// vencidos/por vencer, una vez por día calendario. Se apoya en
// dashboard_requerimientos_historial: si ya existe una fila para hoy, ya se
// corrió; si no, hace ambas cosas.
//
// La pasada de incidencias hace falta porque el paso del tiempo no dispara
// ninguna escritura: un mantenimiento agendado para mañana no cierra nada hoy,
// y al llegar su fecha nadie toca la tabla. Los cambios explícitos (crear,
// editar o borrar un mantenimiento) los resuelve mantenimientoRepo en el acto.
//
// Se llama desde el timer diario y desde las lecturas del dashboard y de los
// requerimientos, así que corre "una vez al día" sin importar si dispara por uso
// de la app o por el cron.
let sincronizandoHoy: Promise<void> | null = null
export async function ensureDailySync(): Promise<void> {
  const hoy = fechaMexico()
  const manana = fechaMexico(new Date(Date.now() + 24 * 60 * 60 * 1000))
  const yaHoy = await repo.findHistorial(hoy, manana)
  if (yaHoy.length > 0) return

  // Evita carreras si varias peticiones llegan a la vez el primer momento del día
  if (!sincronizandoHoy) {
    sincronizandoHoy = (async () => {
      const pool = await getPool()
      await pendientesRepo.syncIncidenciaStatuses(pool)
      await registrarSnapshotHistorial()
    })().finally(() => { sincronizandoHoy = null })
  }
  await sincronizandoHoy
}

function rangoMesActual(): { start: string; end: string } {
  const { year, month } = partesMexico()
  const pad = (n: number) => String(n).padStart(2, '0')
  const sig = sumarMeses(year, month, 1)
  return { start: `${year}-${pad(month)}-01`, end: `${sig.year}-${pad(sig.month)}-01` }
}

// Ventana móvil de 30 días que termina hoy (incluido), como [start, end).
// No es el mes calendario: el día 3 del mes el resumen seguiría mostrando
// prácticamente nada, y lo que interesa es el gasto reciente de la flota.
function rangoUltimos30Dias(): { start: string; end: string } {
  const hoy = fechaMexico()
  return { start: addDias(hoy, -29), end: addDias(hoy, 1) }
}

// `rango` llega cuando el reporte se pidió por un año o por fechas elegidas a
// mano; sin él se conserva la ventana móvil de 30 días con la que se lee el
// tablero. El rango efectivo va de regreso en la respuesta para que el PDF
// imprima el periodo que realmente se sumó, no el que alguien creyó pedir.
export async function getResumenMes(rango?: Rango | null) {
  const { start, end } = rango ?? rangoUltimos30Dias()
  const [mantenimientos, lotes] = await Promise.all([
    repo.findMantenimientosEnRango(start, end),
    repo.findLotesEnRango(start, end),
  ])

  const porVehiculo = new Map<number, { vehiculo_id: number; vehiculo_nombre: string; vehiculo_tipo: string; cantidad: number; costo_total: number }>()
  for (const m of mantenimientos) {
    const entry = porVehiculo.get(m.vehiculo_id) ?? {
      vehiculo_id: m.vehiculo_id, vehiculo_nombre: m.vehiculo_nombre, vehiculo_tipo: m.vehiculo_tipo, cantidad: 0, costo_total: 0,
    }
    entry.cantidad += 1
    entry.costo_total += m.costo + m.piezas_total
    porVehiculo.set(m.vehiculo_id, entry)
  }
  const vehiculos = [...porVehiculo.values()].sort((a, b) => b.costo_total - a.costo_total)

  const manoObra = mantenimientos.reduce((s, m) => s + m.costo, 0)
  const piezasUsadas = mantenimientos.reduce((s, m) => s + m.piezas_total, 0)
  const piezasCostoTotal = lotes.reduce((s, l) => s + l.cantidad_inicial * l.costo_unitario, 0)

  return {
    rango: { start, end },
    mantenimientos: {
      count: mantenimientos.length,
      // Lo que costó el mantenimiento visto solo: mano de obra más las piezas
      // que consumió. Ojo al sumarlo con el costo de las refacciones compradas:
      // esas piezas ya se cobraron al comprarlas (ver `costo_total_periodo`).
      costo_total: manoObra + piezasUsadas,
      costo_mano_obra: manoObra,
      costo_piezas: piezasUsadas,
      por_vehiculo: vehiculos,
    },
    piezas: {
      count: lotes.length,
      costo_total: piezasCostoTotal,
      lotes,
    },
    // Lo que realmente salió de caja en el periodo. Las piezas se pagan al
    // comprarlas, así que sumar además las que consumieron los mantenimientos
    // las cobraría dos veces: solo entra la mano de obra.
    costo_total_periodo: manoObra + piezasCostoTotal,
  }
}

export async function getMantenimientosCalendario() {
  return repo.findAllMantenimientosConVehiculo()
}

function diffMeses(base: Date, ahora: Date): number {
  return (ahora.getFullYear() - base.getFullYear()) * 12 + (ahora.getMonth() - base.getMonth())
}

function diffDias(base: Date, ahora: Date): number {
  return Math.floor((ahora.getTime() - base.getTime()) / 86_400_000)
}

// mssql devuelve columnas `date`/`datetime` como objetos Date, no como string
function toDateStr(d: string | Date | null | undefined): string | null {
  if (d == null) return null
  if (d instanceof Date) return d.toISOString().split('T')[0]
  return d.split('T')[0]
}

interface Base {
  baseKm:    number
  baseFecha: Date | null
  // El intervalo en km que le toca al PRÓXIMO servicio. Casi siempre es el
  // `intervalo_km` del requerimiento, pero mientras queden primeros servicios
  // sin hacer es el escalón que corresponda (ver shared/intervalos).
  intervaloKm: number | null
}

function baseDe(
  req:  RequerimientoFleet,
  link: { fecha: string | Date; km_actual: number } | null,
  serviciosHechos: number,
): Base {
  const baseKm = link?.km_actual ?? req.km_inicio ?? 0
  const baseFechaStr =
    toDateStr(link?.fecha) ??
    toDateStr(req.fecha_inicio) ??
    toDateStr(req.fecha_compra)
  return {
    baseKm,
    baseFecha: baseFechaStr ? new Date(`${baseFechaStr}T12:00:00`) : null,
    intervaloKm: intervaloKmVigente(
      req.intervalo_km,
      parseIntervalosIniciales(req.intervalos_iniciales_km),
      serviciosHechos,
    ),
  }
}

function isOverdue(req: RequerimientoFleet, base: Base, now: Date): boolean {
  if ((req.trigger_mode === 'km' || req.trigger_mode === 'ambos') && base.intervaloKm != null && req.kilometraje != null) {
    if (req.kilometraje - base.baseKm >= base.intervaloKm) return true
  }
  if ((req.trigger_mode === 'meses' || req.trigger_mode === 'ambos') && req.intervalo_meses != null && base.baseFecha) {
    if (diffMeses(base.baseFecha, now) >= req.intervalo_meses) return true
  }
  return false
}

function isWarning(req: RequerimientoFleet, base: Base, now: Date): boolean {
  if ((req.trigger_mode === 'km' || req.trigger_mode === 'ambos') && base.intervaloKm != null && req.kilometraje != null) {
    if (req.kilometraje - base.baseKm >= base.intervaloKm * 0.75) return true
  }
  if ((req.trigger_mode === 'meses' || req.trigger_mode === 'ambos') && req.intervalo_meses != null && base.baseFecha) {
    if (diffMeses(base.baseFecha, now) >= req.intervalo_meses - 1) return true
  }
  return false
}

// Qué tan cerca está de vencer (o qué tan vencido está), como fracción del
// intervalo ya transcurrido: 1 = justo en el límite, >1 = vencido por esa
// proporción, <1 = todavía falta. Con 'ambos' se toma el más urgente de los dos.
// Sirve para ordenar tanto vencidos como por-vencer de más a menos urgente.
function calcularUrgencia(req: RequerimientoFleet, base: Base, now: Date): number {
  const ratios: number[] = []
  if ((req.trigger_mode === 'km' || req.trigger_mode === 'ambos') && base.intervaloKm != null && req.kilometraje != null) {
    ratios.push((req.kilometraje - base.baseKm) / base.intervaloKm)
  }
  if ((req.trigger_mode === 'meses' || req.trigger_mode === 'ambos') && req.intervalo_meses != null && base.baseFecha) {
    ratios.push(diffMeses(base.baseFecha, now) / req.intervalo_meses)
  }
  return ratios.length ? Math.max(...ratios) : 0
}

interface RequerimientoFleetConUrgencia extends RequerimientoFleet {
  urgencia: number
}

async function clasificarRequerimientosFleet() {
  const requerimientos = await repo.findRequerimientosActivosFleet()
  const links = await repo.findMantenimientoLinks(requerimientos.map(r => r.id))
  // Un preventivo que existía por una garantía deja de pedirse cuando todas las
  // garantías que lo sostenían se acabaron: no cuenta como vencido ni como por
  // vencer, y con eso sale del tablero, del calendario y de las alertas de la
  // unidad. El requerimiento se queda en la ficha, en gris, diciendo por qué.
  const silenciados = await garantiasService.idsSilenciadosPorGarantia()

  const lastLinkByReq = new Map<number, { fecha: string; km_actual: number | null }>()
  // Cuántas veces se ha atendido cada preventivo. Solo importa cuando trae
  // primeros servicios: es lo que dice en qué escalón va.
  const hechosByReq = new Map<number, number>()
  for (const l of links) {
    if (!lastLinkByReq.has(l.pendiente_id)) lastLinkByReq.set(l.pendiente_id, l)
    hechosByReq.set(l.pendiente_id, (hechosByReq.get(l.pendiente_id) ?? 0) + 1)
  }

  const now = fechaMexicoComoDate()
  const vencidos: RequerimientoFleetConUrgencia[] = []
  const porVencer: RequerimientoFleetConUrgencia[] = []

  for (const req of requerimientos) {
    if (silenciados.has(req.id)) continue
    const base = baseDe(req, lastLinkByReq.get(req.id) ?? null, hechosByReq.get(req.id) ?? 0)
    const urgencia = calcularUrgencia(req, base, now)
    if (isOverdue(req, base, now)) vencidos.push({ ...req, urgencia })
    else if (isWarning(req, base, now)) porVencer.push({ ...req, urgencia })
  }

  vencidos.sort((a, b) => b.urgencia - a.urgencia)
  porVencer.sort((a, b) => b.urgencia - a.urgencia)

  return { vencidos, porVencer }
}

export interface RequerimientoVencido {
  id:              number
  nombre:          string
  categoria:       string | null
  vehiculo_id:     number
  vehiculo_nombre: string
  /**
   * De dónde sale la alerta. 'programa' es la tabla del fabricante —una visita
   * completa que ya toca, o un renglón que venció por su límite de meses—;
   * 'requerimiento' es un preventivo suelto de la unidad. Se distinguen porque
   * se atienden en pantallas distintas.
   */
  origen:          'requerimiento' | 'programa'
}

// Las alertas del programa no tienen un `pendiente` detrás, así que no traen id
// propio. Se les da uno negativo: el tablero solo lo usa para distinguir
// renglones, y así nunca choca con el de un requerimiento real.
function comoRequerimiento(
  alertas: programaVehiculoService.AlertaPrograma[], desde: number,
): RequerimientoVencido[] {
  return alertas.map((a, i) => ({
    id:              -(desde + i + 1),
    nombre:          a.nombre,
    categoria:       a.categoria,
    vehiculo_id:     a.vehiculo_id,
    vehiculo_nombre: a.vehiculo_nombre,
    origen:          'programa' as const,
  }))
}

export async function getRequerimientosVencidos(): Promise<RequerimientoVencido[]> {
  await ensureDailySync()
  const [{ vencidos }, programa] = await Promise.all([
    clasificarRequerimientosFleet(),
    programaVehiculoService.clasificarFleet(),
  ])
  const sueltos: RequerimientoVencido[] = vencidos.map(r => ({
    id: r.id, nombre: r.nombre, categoria: r.categoria,
    vehiculo_id: r.vehiculo_id, vehiculo_nombre: r.vehiculo_nombre,
    origen: 'requerimiento' as const,
  }))
  return [...sueltos, ...comoRequerimiento(programa.vencidos, sueltos.length)]
}

export async function getRequerimientosPorVencer(): Promise<RequerimientoVencido[]> {
  await ensureDailySync()
  const [{ porVencer }, programa] = await Promise.all([
    clasificarRequerimientosFleet(),
    programaVehiculoService.clasificarFleet(),
  ])
  const sueltos: RequerimientoVencido[] = porVencer.map(r => ({
    id: r.id, nombre: r.nombre, categoria: r.categoria,
    vehiculo_id: r.vehiculo_id, vehiculo_nombre: r.vehiculo_nombre,
    origen: 'requerimiento' as const,
  }))
  return [...sueltos, ...comoRequerimiento(programa.porVencer, sueltos.length)]
}

// Incidencias abiertas de la flota, las más graves primero. Pasa por
// ensureDailySync para que un mantenimiento agendado cuya fecha ya llegó no siga
// contando como pendiente.
export async function getIncidenciasAbiertas(): Promise<repo.IncidenciaAbiertaFleet[]> {
  await ensureDailySync()
  return repo.findIncidenciasAbiertasFleet()
}

// ─── Seguros / permisos / licencias por vencer ──────────────────────────────
// Ventana de alerta: se avisa de los documentos que ya vencieron o que vencen
// dentro de este número de días.
const DIAS_ALERTA_DOCUMENTOS = 30

// Fecha hasta la que se considera "por vencer". La usa también la búsqueda de
// vehículos, para que su filtro y este tablero digan lo mismo.
export function limiteAlertaDocumentos(): string {
  return addDias(fechaMexico(), DIAS_ALERTA_DOCUMENTOS)
}

// Vehículos con al menos un requerimiento preventivo vencido. Se expone para
// que la búsqueda de vehículos filtre por lo mismo que avisa el tablero, sin
// reimplementar la regla (km contra el último mantenimiento + intervalo en
// meses) ni en SQL ni en el navegador.
export async function getVehiculosConRequerimientosVencidos(): Promise<number[]> {
  // También las del programa del fabricante: si el tablero dice que una unidad
  // trae un servicio vencido, el filtro de la búsqueda tiene que encontrarla.
  const [sueltos, programa] = await Promise.all([
    clasificarRequerimientosFleet(),
    programaVehiculoService.clasificarFleet(),
  ])
  return [...new Set([
    ...sueltos.vencidos.map((r) => r.vehiculo_id),
    ...programa.vencidos.map((r) => r.vehiculo_id),
  ])]
}

export interface LicenciaPorVencer {
  conductor_id:     number
  conductor:        string
  tipo:             'estatal' | 'federal' | 'expediente'
  numero:           string | null
  // Texto tal como se capturó, para mostrarlo igual que en el catálogo.
  vigencia:         string
  // La misma vigencia ya interpretada como fecha (YYYY-MM-DD).
  fecha_expiracion: string
  dias_restantes:   number
}

export interface DocumentosPorVencer {
  seguros:   (repo.SeguroPorVencer  & { dias_restantes: number })[]
  permisos:  (repo.PermisoPorVencer & { dias_restantes: number })[]
  licencias: LicenciaPorVencer[]
  tenencias: (repo.TenenciaPorVencer & { dias_restantes: number })[]
  // Faltantes de plano, sin fecha con la cual aparecer en las listas de arriba.
  sin_tenencia: repo.VehiculoSinDocumento[]
  sin_seguro:   repo.VehiculoSinDocumento[]
}

// Con `rango` el reporte contesta otra pregunta: no "qué vence pronto" sino
// "qué vence entre estas dos fechas" — que es como se arma el calendario de
// trámites de un año. El límite superior pasa a ser el fin del rango, y lo que
// vence antes del inicio se descarta (ya se tramitó o ya se dejó pasar).
export async function getDocumentosPorVencer(rango?: Rango | null): Promise<DocumentosPorVencer> {
  const hoy = fechaMexico()
  // `end` es exclusivo: el último día que cuenta es el anterior.
  const limite = rango ? addDias(rango.end, -1) : addDias(hoy, DIAS_ALERTA_DOCUMENTOS)
  const piso   = rango ? rango.start : null
  const dentro = (fecha: string) => (piso ? fecha >= piso : true)
  const hoyDate = new Date(`${hoy}T12:00:00`)
  const dias = (fecha: string) => diffDias(hoyDate, new Date(`${fecha}T12:00:00`))

  const [seguros, permisos, conductores, tenencias, sinTenencia, sinSeguro] = await Promise.all([
    repo.findSegurosPorVencer(limite),
    repo.findPermisosPorVencer(limite),
    repo.findConductoresConVigencia(),
    repo.findTenenciasPorVencer(limite),
    repo.findVehiculosSinTenencia(),
    repo.findVehiculosSinSeguro(),
  ])

  // Las licencias no se pueden filtrar en SQL (vigencia es varchar): se
  // interpreta el texto aquí y se descarta lo que no sea una fecha legible.
  const licencias: LicenciaPorVencer[] = []
  for (const c of conductores) {
    const candidatos = [
      { tipo: 'estatal' as const, numero: c.licencia_estatal_numero, vigencia: c.licencia_estatal_vigencia },
      { tipo: 'federal' as const, numero: c.licencia_federal_numero, vigencia: c.licencia_federal_vigencia },
      // El expediente vence por su cuenta: si no entrara aquí, sería la única
      // vigencia del sistema que nadie avisa.
      { tipo: 'expediente' as const, numero: c.licencia_federal_expediente, vigencia: c.licencia_federal_expediente_vigencia },
    ]
    for (const lic of candidatos) {
      if (!lic.vigencia) continue
      const fecha = parseVigencia(lic.vigencia)
      if (!fecha) continue
      const restantes = dias(fecha)
      // Sin rango se conserva la alerta de siempre (2 meses); con rango manda
      // el rango, que puede mirar mucho más lejos o hacia atrás.
      if (rango ? !(dentro(fecha) && fecha <= limite) : restantes > DIAS_ALERTA_LICENCIA) continue
      licencias.push({
        conductor_id: c.id, conductor: c.nombre,
        tipo: lic.tipo, numero: lic.numero,
        vigencia: lic.vigencia, fecha_expiracion: fecha, dias_restantes: restantes,
      })
    }
  }
  licencias.sort((a, b) => a.dias_restantes - b.dias_restantes)

  return {
    seguros:  seguros.filter((s)  => dentro(s.fecha_expiracion)).map((s)  => ({ ...s,  dias_restantes: dias(s.fecha_expiracion) })),
    permisos: permisos.filter((p) => dentro(p.fecha_expiracion)).map((p) => ({ ...p, dias_restantes: dias(p.fecha_expiracion) })),
    licencias,
    tenencias: tenencias.filter((t) => dentro(t.fecha_expiracion)).map((t) => ({ ...t, dias_restantes: dias(t.fecha_expiracion) })),
    sin_tenencia: sinTenencia,
    sin_seguro:   sinSeguro,
  }
}

export async function registrarSnapshotHistorial(): Promise<void> {
  // Cuenta las dos fuentes, igual que las tarjetas de vencidos y por vencer:
  // si la gráfica sumara solo los requerimientos sueltos, diría un número
  // distinto al que el tablero muestra justo encima.
  const [sueltos, programa] = await Promise.all([
    clasificarRequerimientosFleet(),
    programaVehiculoService.clasificarFleet(),
  ])
  const hoy = fechaMexico()
  await repo.upsertSnapshotHistorial(
    hoy,
    sueltos.vencidos.length  + programa.vencidos.length,
    sueltos.porVencer.length + programa.porVencer.length,
  )
}

export async function getHistorial(meses = 12): Promise<repo.HistorialDia[]> {
  await ensureDailySync()
  const hoy = fechaMexico()
  const { year, month } = partesMexico()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ini = sumarMeses(year, month, -meses)
  const sig = sumarMeses(year, month, 1)
  const start = `${ini.year}-${pad(ini.month)}-01`
  const end   = `${sig.year}-${pad(sig.month)}-01`

  const dias = await repo.findHistorial(start, end)

  // Si el snapshot diario aún no corrió hoy, agrega el conteo en vivo para no mostrar el día en blanco.
  if (toDateStr(dias[dias.length - 1]?.fecha) !== hoy) {
    const { vencidos, porVencer } = await clasificarRequerimientosFleet()
    dias.push({ fecha: hoy, vencidos: vencidos.length, por_vencer: porVencer.length })
  }

  return dias
}

// ─── Reporte de flota (PDF) ────────────────────────────────────────────────────

export interface VehiculoReporte {
  id:                    number
  tipo:                  string
  marca:                 string
  modelo:                string
  serie:                 string
  placas:                string | null
  status:                string | null
  kilometraje:           number | null
  ubicacion:             string | null
  sucursal_id:           number | null
  sucursal:              string | null
  ruta_id:               number | null
  ruta:                  string | null
  mantenimientos_mes:    number
  costo_mano_obra_mes:   number
  costo_piezas_mes:      number
  ultimo_mantenimiento:  string | null
  vencidos:              number
  por_vencer:            number
}

export interface ReporteFlota {
  periodo:      'mes' | 'semana'
  rango_costos: Rango
  costos: {
    mano_obra:           number
    piezas_usadas:       number
    piezas_compradas:    number
    total_mantenimiento: number
    total:               number
  }
  comparacion: {
    rango_actual:                          Rango
    rango_anterior:                        Rango
    /** `null` cuando el periodo ya cerró y no hay snapshot de esa fecha. */
    vencidos_actual:                       number | null
    vencidos_anterior:                     number | null
    /**
     * De dónde salió `vencidos_actual`: `vivo` es el conteo de hoy —el periodo
     * sigue abierto—, `historico` el snapshot al cierre del periodo. El reporte
     * lo dice, porque no es lo mismo "hoy hay 12" que "al cierre había 12".
     */
    origen_actual:                         'vivo' | 'historico'
  }
  vehiculos: VehiculoReporte[]
}

// `rango` acota los costos (mantenimientos y lotes) a un periodo elegido; el
// inventario de unidades y los pendientes siempre son del día, porque son un
// estado actual y no algo que ocurrió entre dos fechas.
export async function getReporteFlota(
  periodo: 'mes' | 'semana' = 'mes', rango?: Rango | null,
): Promise<ReporteFlota> {
  await ensureDailySync()

  const rangoMes = rango ?? rangoMesActual()
  const [vehiculosBase, costosPorVehiculo, lotes, clasificacion] = await Promise.all([
    vehiculosRepo.findAllParaReporte(),
    repo.findCostosPorVehiculoEnRango(rangoMes.start, rangoMes.end),
    repo.findLotesEnRango(rangoMes.start, rangoMes.end),
    clasificarRequerimientosFleet(),
  ])

  const costosMap = new Map(costosPorVehiculo.map(c => [c.vehiculo_id, c]))
  const vencidosPorVehiculo = new Map<number, number>()
  for (const r of clasificacion.vencidos)  vencidosPorVehiculo.set(r.vehiculo_id, (vencidosPorVehiculo.get(r.vehiculo_id) ?? 0) + 1)
  const porVencerPorVehiculo = new Map<number, number>()
  for (const r of clasificacion.porVencer) porVencerPorVehiculo.set(r.vehiculo_id, (porVencerPorVehiculo.get(r.vehiculo_id) ?? 0) + 1)

  const vehiculos: VehiculoReporte[] = vehiculosBase.map(v => {
    const c = costosMap.get(v.id)
    return {
      id: v.id, tipo: v.tipo, marca: v.marca, modelo: v.modelo, serie: v.serie,
      placas: v.placas, status: v.status, kilometraje: v.kilometraje,
      ubicacion: v.ubicacion, sucursal_id: v.sucursal_id, sucursal: v.sucursal,
      ruta_id: v.ruta_id, ruta: v.ruta,
      mantenimientos_mes:   c?.mantenimientos_count ?? 0,
      costo_mano_obra_mes:  c?.costo_mano_obra ?? 0,
      costo_piezas_mes:     c?.costo_piezas ?? 0,
      ultimo_mantenimiento: toDateStr(c?.ultimo_mantenimiento ?? null),
      vencidos:             vencidosPorVehiculo.get(v.id) ?? 0,
      por_vencer:           porVencerPorVehiculo.get(v.id) ?? 0,
    }
  })

  const manoObra        = costosPorVehiculo.reduce((s, c) => s + c.costo_mano_obra, 0)
  const piezasUsadas     = costosPorVehiculo.reduce((s, c) => s + c.costo_piezas, 0)
  const piezasCompradas  = lotes.reduce((s, l) => s + l.cantidad_inicial * l.costo_unitario, 0)

  // La comparación se mide sobre el mismo periodo que los costos. Antes eran
  // dos ventanas independientes —los costos del mes y los vencidos contra la
  // semana pasada—, lo que ya se leía raro; con un rango elegido a mano se
  // volvía absurdo: un reporte de todo 2025 comparándose contra el mes pasado.
  // `periodo` ('mes'/'semana') sigue mandando solo cuando no se pidió rango,
  // que es el caso para el que se hizo.
  const { actual, anterior } = rango
    ? { actual: rango, anterior: ventanaPrevia(rango) }
    : rangoActualYAnterior(periodo)

  // Último día cubierto por cada ventana: la referencia contra la que se busca
  // el snapshot histórico de vencidos.
  const finActual   = addDias(actual.end, -1)
  const fechaRefAnterior = addDias(anterior.end, -1)

  // Un periodo que ya cerró no se puede medir con el conteo de hoy: los
  // vencidos de 2025 son los que había al 31 de diciembre, no los de esta
  // mañana. Para esos se lee el snapshot diario; para un periodo que todavía
  // incluye hoy, el conteo en vivo es el dato bueno.
  const cerrado = finActual < fechaMexico()
  const [snapshotActual, snapshotAnterior] = await Promise.all([
    cerrado ? repo.findHistorialCercano(finActual) : Promise.resolve(null),
    repo.findHistorialCercano(fechaRefAnterior),
  ])

  return {
    periodo,
    rango_costos: rangoMes,
    costos: {
      mano_obra:           manoObra,
      piezas_usadas:       piezasUsadas,
      piezas_compradas:    piezasCompradas,
      total_mantenimiento: manoObra + piezasUsadas,
      // `piezas_usadas` no entra: esas piezas ya se pagaron al comprarlas y
      // están dentro de `piezas_compradas`. Sumarlas contaría el gasto dos veces.
      total:               manoObra + piezasCompradas,
    },
    comparacion: {
      rango_actual:   actual,
      rango_anterior: anterior,
      vencidos_actual:                       cerrado ? (snapshotActual?.vencidos ?? null) : clasificacion.vencidos.length,
      vencidos_anterior:                     snapshotAnterior?.vencidos ?? null,
      origen_actual:                         cerrado ? 'historico' : 'vivo',
    },
    vehiculos,
  }
}
