// Arma la bitácora de un día y el resumen del mes que alimenta el calendario.
import * as repo from '../repositories/actividadDiaRepo'
import * as vence from '../repositories/vencimientosRepo'
import { findConductoresConVigencia } from '../repositories/dashboardRepo'
import { parseVigencia } from '../shared/vigenciaLicencia'
import { ValidationError } from '../shared/errors'

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/
const RE_MES   = /^\d{4}-\d{2}$/

// Las fechas entran como texto y van directo a un parámetro sql.Date. Validar
// el formato aquí evita que una cadena basura llegue al driver como un error
// críptico de conversión, y confirma que el día realmente existe (un '2026-02-30'
// pasa el regex pero no es una fecha).
function validarFecha(fecha: string): string {
  if (!RE_FECHA.test(fecha)) throw new ValidationError('La fecha debe venir como YYYY-MM-DD')
  const d = new Date(`${fecha}T00:00:00Z`)
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== fecha) {
    throw new ValidationError(`La fecha ${fecha} no existe`)
  }
  return fecha
}

// ─── Documentos que expiran ──────────────────────────────────────────────────

export type TipoVencimiento = 'seguro' | 'permiso' | 'tenencia' | 'licencia'

// Las cuatro clases de documento en una sola forma. Vienen de tablas sin nada
// en común —una póliza cubre varias unidades, una tenencia es de una sola, una
// licencia es de una persona— así que en vez de exponer cuatro listas que el
// calendario tendría que volver a unir, se normalizan aquí: `titulo` es cómo se
// llama el documento y `detalle` el contexto que lo identifica.
export interface Vencimiento {
  /** Único entre tipos: un seguro y una tenencia pueden compartir id. */
  key:              string
  tipo:             TipoVencimiento
  fecha_expiracion: string
  titulo:           string
  detalle:          string
  /** Para saltar a la ficha; null en licencias, que son de un conductor. */
  vehiculo_id:      number | null
  conductor_id:     number | null
}

const TIPO_LICENCIA: Record<string, string> = {
  estatal:    'Licencia estatal',
  federal:    'Licencia federal',
  expediente: 'Expediente federal',
}

// Las licencias se filtran aquí y no en SQL: la vigencia es varchar y una
// comparación de fechas en el motor descartaría filas válidas. Lo que no se
// entiende como fecha se ignora, igual que en el tablero.
async function licenciasEnRango(start: string, end: string): Promise<Vencimiento[]> {
  const conductores = await findConductoresConVigencia()
  const out: Vencimiento[] = []
  for (const c of conductores) {
    const candidatos = [
      { tipo: 'estatal',    numero: c.licencia_estatal_numero,    vigencia: c.licencia_estatal_vigencia },
      { tipo: 'federal',    numero: c.licencia_federal_numero,    vigencia: c.licencia_federal_vigencia },
      { tipo: 'expediente', numero: c.licencia_federal_expediente, vigencia: c.licencia_federal_expediente_vigencia },
    ]
    for (const lic of candidatos) {
      const fecha = parseVigencia(lic.vigencia)
      if (!fecha || fecha < start || fecha > end) continue
      out.push({
        key:              `licencia-${c.id}-${lic.tipo}`,
        tipo:             'licencia',
        fecha_expiracion: fecha,
        titulo:           c.nombre,
        detalle:          `${TIPO_LICENCIA[lic.tipo]}${lic.numero ? ` ${lic.numero}` : ''}`,
        vehiculo_id:      null,
        conductor_id:     c.id,
      })
    }
  }
  return out
}

export async function getVencimientosEnRango(start: string, end: string): Promise<Vencimiento[]> {
  const [seguros, permisos, tenencias, licencias] = await Promise.all([
    vence.findSegurosEnRango(start, end),
    vence.findPermisosEnRango(start, end),
    vence.findTenenciasEnRango(start, end),
    licenciasEnRango(start, end),
  ])

  const items: Vencimiento[] = [
    ...seguros.map((s): Vencimiento => ({
      key: `seguro-${s.id}`, tipo: 'seguro', fecha_expiracion: s.fecha_expiracion,
      titulo: `Póliza ${s.poliza}`,
      detalle: `${s.compania} · ${s.vehiculos} unidad${s.vehiculos !== 1 ? 'es' : ''}`,
      vehiculo_id: null, conductor_id: null,
    })),
    ...permisos.map((p): Vencimiento => ({
      key: `permiso-${p.id}`, tipo: 'permiso', fecha_expiracion: p.fecha_expiracion,
      titulo: p.zona_circulacion,
      detalle: `Permiso de circulación · ${p.vehiculos} unidad${p.vehiculos !== 1 ? 'es' : ''}`,
      vehiculo_id: null, conductor_id: null,
    })),
    ...tenencias.map((t): Vencimiento => ({
      key: `tenencia-${t.vehiculo_id}`, tipo: 'tenencia', fecha_expiracion: t.fecha_expiracion,
      titulo: t.vehiculo,
      detalle: `Tenencia${t.placas ? ` · ${t.placas}` : ''}`,
      vehiculo_id: t.vehiculo_id, conductor_id: null,
    })),
    ...licencias,
  ]

  return items.sort((a, b) =>
    a.fecha_expiracion.localeCompare(b.fecha_expiracion) || a.titulo.localeCompare(b.titulo))
}

export interface TotalesDia {
  mano_obra:   number
  refacciones: number
  combustible: number
  /** Lo que salió de caja ese día: los tres anteriores. */
  total:       number
  /** Litros cargados, para el detalle de combustible. */
  litros:      number
  /**
   * Piezas consumidas por los mantenimientos del día. Se informa aparte y NO
   * entra en `total`: esas piezas ya se pagaron al comprarlas (aparecen en
   * `refacciones` el día de su compra) y sumarlas aquí las cobraría dos veces.
   */
  piezas_usadas: number
}

export async function getActividadDelDia(fechaRaw: string) {
  const fecha = validarFecha(fechaRaw)

  const [
    mantenimientos, recargas, vales,
    incidenciasAbiertas, incidenciasCerradas, compras, traspasos, vencimientos,
  ] = await Promise.all([
    repo.findMantenimientosDelDia(fecha),
    repo.findRecargasDelDia(fecha),
    repo.findValesDelDia(fecha),
    repo.findIncidenciasAbiertasDelDia(fecha),
    repo.findIncidenciasCerradasDelDia(fecha),
    repo.findComprasDelDia(fecha),
    repo.findTraspasosDelDia(fecha),
    // Un vencimiento no es algo que "ocurrió" ese día como los demás: es una
    // fecha límite que cae ahí. Va en el mismo panel porque es exactamente lo
    // que se busca al abrir un día futuro.
    getVencimientosEnRango(fecha, fecha),
  ])

  const manoObra    = mantenimientos.reduce((s, m) => s + m.costo, 0)
  const piezasUsadas = mantenimientos.reduce((s, m) => s + m.piezas_total, 0)
  const refacciones = compras.reduce((s, c) => s + c.cantidad_inicial * c.costo_unitario, 0)
  const combustible = recargas.reduce((s, r) => s + r.costo, 0)
  const litros      = recargas.reduce((s, r) => s + r.litros, 0)

  const totales: TotalesDia = {
    mano_obra:     manoObra,
    refacciones,
    combustible,
    total:         manoObra + refacciones + combustible,
    litros,
    piezas_usadas: piezasUsadas,
  }

  return {
    fecha,
    totales,
    mantenimientos,
    recargas,
    vales,
    incidencias_abiertas: incidenciasAbiertas,
    incidencias_cerradas: incidenciasCerradas,
    compras,
    traspasos,
    vencimientos,
  }
}

// El calendario pinta un mes a la vez, así que el resumen se acota al mes
// pedido en vez de traer la flota entera como hacía la vista de mantenimientos.
export async function getActividadDelMes(mesRaw: string) {
  if (!RE_MES.test(mesRaw)) throw new ValidationError('El mes debe venir como YYYY-MM')
  const [anio, mes] = mesRaw.split('-').map(Number)
  if (mes < 1 || mes > 12) throw new ValidationError(`El mes ${mesRaw} no existe`)

  const start = `${mesRaw}-01`
  // Día 0 del mes siguiente es el último del pedido, y Date lo resuelve solo
  // para 28/29/30/31 sin tabla de días por mes.
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  const end = `${mesRaw}-${String(ultimo).padStart(2, '0')}`

  // Los vencimientos van completos, no como conteo por día: son pocos al mes y
  // el calendario necesita saber de qué tipo es cada uno para pintarlo, cosa
  // que un contador no dice.
  const [dias, vencimientos] = await Promise.all([
    repo.findActividadPorDia(start, end),
    getVencimientosEnRango(start, end),
  ])
  return { mes: mesRaw, rango: { start, end }, dias, vencimientos }
}
