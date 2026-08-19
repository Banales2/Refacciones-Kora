// Arma la bitácora de un día y el resumen del mes que alimenta el calendario.
import * as repo from '../repositories/actividadDiaRepo'
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
    incidenciasAbiertas, incidenciasCerradas, compras, traspasos,
  ] = await Promise.all([
    repo.findMantenimientosDelDia(fecha),
    repo.findRecargasDelDia(fecha),
    repo.findValesDelDia(fecha),
    repo.findIncidenciasAbiertasDelDia(fecha),
    repo.findIncidenciasCerradasDelDia(fecha),
    repo.findComprasDelDia(fecha),
    repo.findTraspasosDelDia(fecha),
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

  const dias = await repo.findActividadPorDia(start, end)
  return { mes: mesRaw, rango: { start, end }, dias }
}
