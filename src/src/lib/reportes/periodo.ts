// Periodo que cubre un reporte.
//
// Cada reporte traía su ventana cableada —30 días el resumen, el mes en curso
// el de flota, cuatro ventanas fijas el de costos— y ninguna se podía mover.
// Sirve para el tablero, que se lee de pasada, pero no para un reporte que se
// archiva: ahí se pide "todo 2025" para el cierre del año, o "del 1 al 15 de
// marzo" para cuadrar contra una factura.
//
// Aquí vive esa elección, en un solo tipo, porque la comparten el modal del
// tablero, el historial de mantenimientos y el expediente de cada unidad. Los
// reportes que consultan la API la mandan como query; los que filtran una lista
// que ya está en memoria usan `dentroDelPeriodo`.
import { hoyIso } from '../fechas'

export type Periodo =
  /** La ventana de siempre del reporte. Cada uno sabe cuál es la suya. */
  | { modo: 'default' }
  /** Ventana móvil que termina hoy: los últimos N días. */
  | { modo: 'dias';  dias: number }
  /** Un año de calendario completo, del 1 de enero al 31 de diciembre. */
  | { modo: 'anio';  anio: number }
  /** Dos fechas elegidas a mano, ambas inclusive. */
  | { modo: 'rango'; desde: string; hasta: string }

export const PERIODO_DEFAULT: Periodo = { modo: 'default' }

/** Rango efectivo en ISO, ambas fechas inclusive. `null` = sin acotar. */
export interface RangoISO { desde: string; hasta: string }

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function rangoDe(p: Periodo): RangoISO | null {
  switch (p.modo) {
    case 'dias':  return { desde: sumarDias(hoyIso(), -(p.dias - 1)), hasta: hoyIso() }
    case 'anio':  return { desde: `${p.anio}-01-01`, hasta: `${p.anio}-12-31` }
    case 'rango': return { desde: p.desde, hasta: p.hasta }
    default:      return null
  }
}

/**
 * Query para los endpoints que aceptan periodo. Un año se manda como `anio`
 * en vez de dos fechas para que el backend no tenga que adivinar que ese rango
 * era un año: el reporte lo dice y así queda escrito.
 */
export function queryPeriodo(p: Periodo): string {
  if (p.modo === 'anio') return `anio=${p.anio}`
  const r = rangoDe(p)
  return r ? `desde=${r.desde}&hasta=${r.hasta}` : ''
}

/** Encadena la query del periodo a una URL que quizá ya trae parámetros. */
export function conPeriodo(url: string, p: Periodo): string {
  const q = queryPeriodo(p)
  if (!q) return url
  return `${url}${url.includes('?') ? '&' : '?'}${q}`
}

/** Un periodo incompleto no se puede pedir: el rango a medias no es un rango. */
export function periodoValido(p: Periodo): boolean {
  if (p.modo !== 'rango') return true
  return !!p.desde && !!p.hasta && p.desde <= p.hasta
}

function fechaLarga(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

/**
 * Cómo se nombra el periodo en la portada del reporte y en el nombre del
 * archivo. `fallback` es lo que dice el reporte cuando no se acotó nada — es
 * distinto en cada uno, porque su ventana de siempre también lo es.
 */
export function etiquetaPeriodo(p: Periodo, fallback = 'Periodo predeterminado'): string {
  switch (p.modo) {
    case 'dias':  return `Últimos ${p.dias} días`
    case 'anio':  return `Año ${p.anio}`
    // Un rango a medias no llega hasta un reporte (el botón espera a que estén
    // las dos fechas), pero la etiqueta también se pinta mientras se escribe.
    case 'rango': return periodoValido(p)
      ? `${fechaLarga(p.desde)} – ${fechaLarga(p.hasta)}`
      : 'Rango sin terminar'
    default:      return fallback
  }
}

/** Sufijo para el nombre de archivo, para no sobrescribir dos cortes distintos. */
export function sufijoPeriodo(p: Periodo): string {
  switch (p.modo) {
    case 'dias':  return `${p.dias}d`
    case 'anio':  return String(p.anio)
    case 'rango': return `${p.desde}_${p.hasta}`
    default:      return ''
  }
}

/**
 * Filtro para los reportes que se arman con datos que ya están en memoria (el
 * historial de mantenimientos, el expediente de una unidad). Las fechas llegan
 * como ISO con o sin hora; se compara solo el día, que es la resolución con la
 * que se captura todo en el sistema.
 */
export function dentroDelPeriodo(fecha: string | null | undefined, p: Periodo): boolean {
  const r = rangoDe(p)
  if (!r) return true
  if (!fecha) return false
  const dia = fecha.split('T')[0]
  return dia >= r.desde && dia <= r.hasta
}

/** Los años que ofrece el selector: del actual hacia atrás, sin inventar futuro. */
export function aniosDisponibles(cantidad = 6): number[] {
  const actual = new Date().getFullYear()
  return Array.from({ length: cantidad }, (_, i) => actual - i)
}
