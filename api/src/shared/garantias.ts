// Cuándo se le acaba la garantía a una unidad.
//
// Vive aquí y no en un service porque la usan dos: el módulo de garantías, para
// pintar el estado en la ficha del vehículo, y el tablero, que necesita saber
// qué requerimientos preventivos ya no hay que pedir porque la garantía que los
// exigía caducó.
//
// El estado no se guarda: se calcula contra la fecha de arranque y el odómetro
// de hoy. Un campo "vencida" en la tabla necesitaría un proceso que lo
// mantuviera y se desincronizaría en cuanto alguien corrigiera la fecha de
// compra de la unidad.
import { fechaMexico } from './fechaMexico'

export type TriggerMode = 'km' | 'meses' | 'ambos'

/** Lo mínimo que hace falta para saber si una garantía sigue viva. */
export interface GarantiaVigencia {
  trigger_mode:   TriggerMode
  duracion_meses: number | null
  limite_km:      number | null
  fecha_inicio:   string | Date | null
  km_inicio:      number | null
  cancelada_en:   string | Date | null
}

export type MotivoVencimiento = 'cancelada' | 'tiempo' | 'kilometraje'

export interface EstadoGarantia {
  vigente: boolean
  /** Por qué se acabó. Null mientras siga viva. */
  motivo:  MotivoVencimiento | null
  /** Día en que caduca por tiempo. Null si no vence por tiempo o falta la fecha de inicio. */
  vence_el:      string | null
  /** Odómetro en el que caduca por kilometraje. */
  vence_a_los_km: number | null
  /** Lo que le queda. Negativo = por cuánto ya se pasó. Null cuando no aplica o falta el dato. */
  meses_restantes: number | null
  km_restantes:    number | null
  /**
   * Qué le falta al registro para poder calcularse ('fecha_inicio', 'km_inicio',
   * 'kilometraje'). Una garantía con datos incompletos se trata como vigente:
   * silenciar un mantenimiento por un dato que nadie capturó sería peor que
   * pedirlo de más.
   */
  faltan_datos: string[]
}

// mssql devuelve las columnas `date` como Date, no como string.
function aFechaStr(d: string | Date | null): string | null {
  if (d == null) return null
  if (d instanceof Date) return fechaMexico(d)
  return d.split('T')[0]
}

function aDate(ymd: string): Date {
  // Anclada a mediodía: leerla como medianoche UTC la corre un día atrás.
  return new Date(`${ymd}T12:00:00`)
}

function diffMeses(base: Date, ahora: Date): number {
  return (ahora.getFullYear() - base.getFullYear()) * 12 + (ahora.getMonth() - base.getMonth())
}

function sumarMeses(ymd: string, meses: number): string {
  const d = aDate(ymd)
  const dia = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + meses)
  // Un arranque el 31 con garantía de un mes cae en un mes de 30: se ancla al
  // último día en vez de saltar al mes siguiente, que es como se leen las
  // vigencias en un certificado.
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(dia, ultimo))
  return fechaMexico(d)
}

/**
 * `kmActual` es el odómetro de la unidad hoy; null en los tipos que no llevan
 * kilometraje (caja de trailer, montacargas), donde una garantía por km no se
 * puede evaluar y por lo tanto no vence.
 *
 * Con `trigger_mode = 'ambos'` gana lo que ocurra primero: así se redactan las
 * garantías ("3 años o 100,000 km, lo que suceda primero"). Ojo: es la lectura
 * contraria a la de un requerimiento, donde 'ambos' es el intervalo que se
 * cumple más seguido.
 */
export function evaluarGarantia(
  g: GarantiaVigencia, kmActual: number | null, hoy: string = fechaMexico()
): EstadoGarantia {
  const cancelada = aFechaStr(g.cancelada_en)
  const inicio    = aFechaStr(g.fecha_inicio)
  const faltan: string[] = []

  const porTiempo = g.trigger_mode === 'meses' || g.trigger_mode === 'ambos'
  const porKm     = g.trigger_mode === 'km'    || g.trigger_mode === 'ambos'

  let vence_el: string | null = null
  let meses_restantes: number | null = null
  if (porTiempo && g.duracion_meses != null) {
    if (inicio) {
      vence_el = sumarMeses(inicio, g.duracion_meses)
      meses_restantes = g.duracion_meses - diffMeses(aDate(inicio), aDate(hoy))
    } else {
      faltan.push('fecha_inicio')
    }
  }

  let vence_a_los_km: number | null = null
  let km_restantes: number | null = null
  if (porKm && g.limite_km != null) {
    const base = g.km_inicio ?? 0
    vence_a_los_km = base + g.limite_km
    if (kmActual != null) km_restantes = vence_a_los_km - kmActual
    else faltan.push('kilometraje')
  }

  // La cancelación manual gana sobre cualquier cálculo: alguien ya dijo que
  // esta unidad perdió la garantía.
  if (cancelada && cancelada <= hoy) {
    return {
      vigente: false, motivo: 'cancelada',
      vence_el, vence_a_los_km, meses_restantes, km_restantes, faltan_datos: faltan,
    }
  }

  if (vence_el != null && hoy >= vence_el) {
    return {
      vigente: false, motivo: 'tiempo',
      vence_el, vence_a_los_km, meses_restantes, km_restantes, faltan_datos: faltan,
    }
  }
  if (km_restantes != null && km_restantes <= 0) {
    return {
      vigente: false, motivo: 'kilometraje',
      vence_el, vence_a_los_km, meses_restantes, km_restantes, faltan_datos: faltan,
    }
  }

  return {
    vigente: true, motivo: null,
    vence_el, vence_a_los_km, meses_restantes, km_restantes, faltan_datos: faltan,
  }
}

/**
 * Un requerimiento atado a garantías deja de pedirse cuando **todas** se
 * acabaron: mientras una siga viva, el servicio se sigue necesitando. Sin
 * garantías atadas se comporta como siempre, y por eso devuelve false.
 */
export function cubiertoPorGarantiaVencida(estados: EstadoGarantia[]): boolean {
  return estados.length > 0 && estados.every((e) => !e.vigente)
}
