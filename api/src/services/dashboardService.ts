import * as repo from '../repositories/dashboardRepo'
import { RequerimientoFleet } from '../repositories/dashboardRepo'
import * as requerimentosRepo from '../repositories/requerimentosRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import { getPool } from '../shared/db'

const MX_TZ = 'America/Mexico_City'

// Azure Functions corre en UTC. Entre ~18:00 y 23:59 hora de México, en UTC ya
// es "mañana" — usar new Date().toISOString() ahí adelanta el snapshot diario
// (y por lo tanto la tendencia del dashboard) un día. Estas funciones anclan
// "hoy" a la fecha calendario de México sin importar la zona horaria del server.
function fechaMexico(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MX_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

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

interface Rango { start: string; end: string }

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

// Sincroniza el status de requerimientos únicos (según la fecha del
// mantenimiento vinculado) una vez por día calendario. Se apoya en
// dashboard_requerimientos_historial: si ya existe una fila para hoy, ya se
// corrió; si no, sincroniza y registra el snapshot del día, dejando
// reportes/gráficas del dashboard al corriente. Se llama desde el timer diario
// y desde las lecturas del dashboard/requerimientos, así que corre "una vez al
// día" sin importar si dispara por uso de la app o por el cron.
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
      await requerimentosRepo.syncUnicaStatuses(pool)
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

export async function getResumenMes() {
  const { start, end } = rangoMesActual()
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

  const mantenimientosCostoTotal = mantenimientos.reduce((s, m) => s + m.costo + m.piezas_total, 0)
  const piezasCostoTotal = lotes.reduce((s, l) => s + l.cantidad_inicial * l.costo_unitario, 0)

  return {
    rango: { start, end },
    mantenimientos: {
      count: mantenimientos.length,
      costo_total: mantenimientosCostoTotal,
      por_vehiculo: vehiculos,
    },
    piezas: {
      count: lotes.length,
      costo_total: piezasCostoTotal,
      lotes,
    },
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
}

function baseDe(
  req:  RequerimientoFleet,
  link: { fecha: string | Date; km_actual: number } | null,
): Base {
  const baseKm = link?.km_actual ?? req.km_inicio ?? 0
  const baseFechaStr =
    toDateStr(link?.fecha) ??
    toDateStr(req.fecha_inicio) ??
    toDateStr(req.fecha_compra)
  return { baseKm, baseFecha: baseFechaStr ? new Date(`${baseFechaStr}T12:00:00`) : null }
}

function isOverdue(req: RequerimientoFleet, base: Base, now: Date): boolean {
  if ((req.trigger_mode === 'km' || req.trigger_mode === 'ambos') && req.intervalo_km != null && req.kilometraje != null) {
    if (req.kilometraje - base.baseKm >= req.intervalo_km) return true
  }
  if ((req.trigger_mode === 'meses' || req.trigger_mode === 'ambos') && req.intervalo_dias != null && base.baseFecha) {
    if (diffDias(base.baseFecha, now) >= req.intervalo_dias) return true
  }
  if ((req.trigger_mode === 'meses' || req.trigger_mode === 'ambos') && req.intervalo_meses != null && base.baseFecha) {
    if (diffMeses(base.baseFecha, now) >= req.intervalo_meses) return true
  }
  return false
}

function isWarning(req: RequerimientoFleet, base: Base, now: Date): boolean {
  if ((req.trigger_mode === 'km' || req.trigger_mode === 'ambos') && req.intervalo_km != null && req.kilometraje != null) {
    if (req.kilometraje - base.baseKm >= req.intervalo_km * 0.75) return true
  }
  if ((req.trigger_mode === 'meses' || req.trigger_mode === 'ambos') && req.intervalo_dias != null && base.baseFecha) {
    if (diffDias(base.baseFecha, now) >= req.intervalo_dias * 0.75) return true
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
  if ((req.trigger_mode === 'km' || req.trigger_mode === 'ambos') && req.intervalo_km != null && req.kilometraje != null) {
    ratios.push((req.kilometraje - base.baseKm) / req.intervalo_km)
  }
  if ((req.trigger_mode === 'meses' || req.trigger_mode === 'ambos') && req.intervalo_dias != null && base.baseFecha) {
    ratios.push(diffDias(base.baseFecha, now) / req.intervalo_dias)
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

  const lastLinkByReq = new Map<number, { fecha: string; km_actual: number }>()
  for (const l of links) {
    if (!lastLinkByReq.has(l.requerimiento_id)) lastLinkByReq.set(l.requerimiento_id, l)
  }

  const now = fechaMexicoComoDate()
  const vencidos: RequerimientoFleetConUrgencia[] = []
  const porVencer: RequerimientoFleetConUrgencia[] = []

  for (const req of requerimientos) {
    const base = baseDe(req, lastLinkByReq.get(req.id) ?? null)
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
}

export async function getRequerimientosVencidos(): Promise<RequerimientoVencido[]> {
  await ensureDailySync()
  const { vencidos } = await clasificarRequerimientosFleet()
  return vencidos
    .map(r => ({ id: r.id, nombre: r.nombre, categoria: r.categoria, vehiculo_id: r.vehiculo_id, vehiculo_nombre: r.vehiculo_nombre }))
}

export async function getRequerimientosPorVencer(): Promise<RequerimientoVencido[]> {
  await ensureDailySync()
  const { porVencer } = await clasificarRequerimientosFleet()
  return porVencer
    .map(r => ({ id: r.id, nombre: r.nombre, categoria: r.categoria, vehiculo_id: r.vehiculo_id, vehiculo_nombre: r.vehiculo_nombre }))
}

export async function registrarSnapshotHistorial(): Promise<void> {
  const { vencidos, porVencer } = await clasificarRequerimientosFleet()
  const hoy = fechaMexico()
  await repo.upsertSnapshotHistorial(hoy, vencidos.length, porVencer.length)
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
    vencidos_actual:                       number
    vencidos_anterior:                     number | null
    requerimientos_unicos_nuevos_actual:   number
    requerimientos_unicos_nuevos_anterior: number
  }
  vehiculos: VehiculoReporte[]
}

export async function getReporteFlota(periodo: 'mes' | 'semana' = 'mes'): Promise<ReporteFlota> {
  await ensureDailySync()

  const rangoMes = rangoMesActual()
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

  const { actual, anterior } = rangoActualYAnterior(periodo)
  // Último día cubierto por el periodo anterior: la referencia contra la que
  // comparamos el snapshot histórico de vencidos.
  const fechaRefAnterior = addDias(anterior.end, -1)
  const [snapshotAnterior, unicosActual, unicosAnterior] = await Promise.all([
    repo.findHistorialCercano(fechaRefAnterior),
    repo.countRequerimientosUnicosCreados(actual.start, actual.end),
    repo.countRequerimientosUnicosCreados(anterior.start, anterior.end),
  ])

  return {
    periodo,
    rango_costos: rangoMes,
    costos: {
      mano_obra:           manoObra,
      piezas_usadas:       piezasUsadas,
      piezas_compradas:    piezasCompradas,
      total_mantenimiento: manoObra + piezasUsadas,
      total:               manoObra + piezasUsadas + piezasCompradas,
    },
    comparacion: {
      rango_actual:   actual,
      rango_anterior: anterior,
      vencidos_actual:                       clasificacion.vencidos.length,
      vencidos_anterior:                     snapshotAnterior?.vencidos ?? null,
      requerimientos_unicos_nuevos_actual:   unicosActual,
      requerimientos_unicos_nuevos_anterior: unicosAnterior,
    },
    vehiculos,
  }
}
