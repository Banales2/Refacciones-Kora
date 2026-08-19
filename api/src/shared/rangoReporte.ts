// Rango de fechas pedido desde la UI para acotar un reporte.
//
// Hasta ahora cada endpoint del tablero traía su ventana cableada: el resumen,
// los últimos 30 días; el reporte de flota, el mes en curso; el análisis de
// costos, una de cuatro ventanas fijas. Sirve para el tablero —que se lee de
// pasada— pero no para un reporte que se firma: ahí se pide "todo 2025" o
// "del 1 de marzo al 15 de abril", y esas fechas tienen que salir impresas.
//
// Aquí se traduce lo que llega por query a un rango semiabierto [start, end),
// que es como lo consumen los repositorios. Se valida en serio porque estos
// rangos se convierten en barridos de SQL: una fecha basura o un rango de
// veinte años se rechazan con 400 en vez de tumbar la consulta.
import { ValidationError } from './errors'
import { fechaMexico } from './fechaMexico'

/** Rango semiabierto [start, end), ambos 'YYYY-MM-DD'. */
export interface Rango { start: string; end: string }

const FORMATO = /^\d{4}-\d{2}-\d{2}$/

// Tope de amplitud. Cinco años cubre cualquier reporte histórico que alguien
// pida a mano y sigue siendo un barrido acotado; más que eso es un volcado de
// la base disfrazado de reporte.
const DIAS_MAX = 366 * 5
const ANIO_MIN = 2000

function esFechaReal(ymd: string): boolean {
  if (!FORMATO.test(ymd)) return false
  const d = new Date(`${ymd}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd
}

function addDias(ymd: string, dias: number): string {
  const d = new Date(`${ymd}T12:00:00`)
  d.setDate(d.getDate() + dias)
  return fechaMexico(d)
}

export function diasDelRango(r: Rango): number {
  const ms = new Date(`${r.end}T12:00:00`).getTime() - new Date(`${r.start}T12:00:00`).getTime()
  return Math.round(ms / 86_400_000)
}

/**
 * Lee `?anio=YYYY` o `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` de la query.
 *
 * `hasta` es **inclusivo** para quien lo escribe —"hasta el 31 de diciembre"
 * quiere decir que ese día cuenta— y se convierte aquí al `end` exclusivo que
 * esperan los repos. Devuelve `null` cuando no se pidió nada: cada endpoint
 * conserva entonces su ventana de siempre.
 */
export function parseRango(query: URLSearchParams): Rango | null {
  const anio = query.get('anio')
  if (anio) {
    const n = Number(anio)
    if (!Number.isInteger(n) || n < ANIO_MIN || n > 2999) {
      throw new ValidationError(`Año inválido: ${anio}`)
    }
    return { start: `${n}-01-01`, end: `${n + 1}-01-01` }
  }

  const desde = query.get('desde')
  const hasta = query.get('hasta')
  if (!desde && !hasta) return null
  if (!desde || !hasta) {
    throw new ValidationError('El rango necesita las dos fechas: desde y hasta.')
  }
  if (!esFechaReal(desde)) throw new ValidationError(`Fecha inicial inválida: ${desde}`)
  if (!esFechaReal(hasta)) throw new ValidationError(`Fecha final inválida: ${hasta}`)
  if (hasta < desde) {
    throw new ValidationError('La fecha final no puede ser anterior a la inicial.')
  }

  const rango = { start: desde, end: addDias(hasta, 1) }
  if (diasDelRango(rango) > DIAS_MAX) {
    throw new ValidationError('El rango no puede pasar de 5 años.')
  }
  return rango
}
