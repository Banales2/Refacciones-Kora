// La vigencia de las licencias (estatal y federal) se captura como texto libre
// porque no siempre viene como fecha completa: hay tarjetas que solo traen el
// año y otras que dicen "3 AÑOS". Para poder alertar del vencimiento se intenta
// leer ese texto como fecha; lo que no se entiende se deja pasar sin alerta en
// vez de inventar una. Espeja api/src/shared/vigenciaLicencia.ts.

// Ventana de aviso: se alerta de las licencias que ya vencieron o que vencen
// dentro de estos días (2 meses).
export const DIAS_ALERTA_LICENCIA = 60

// Fecha calendario de hoy (local) como YYYY-MM-DD.
function hoyISO(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Solo arma la fecha si el día existe de verdad (descarta 31-02, mes 13, etc.).
function armar(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null
  if (day > new Date(year, month, 0).getDate()) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

// Último día del mes: una vigencia sin día se cumple hasta que el mes termina.
function finDeMes(year: number, month: number): string | null {
  if (month < 1 || month > 12) return null
  return armar(year, month, new Date(year, month, 0).getDate())
}

// Convierte el texto de vigencia a YYYY-MM-DD, o null si no es una fecha.
// El formulario filtra las diagonales, pero se aceptan por si quedaron datos
// viejos con ellas.
export function parseVigencia(texto: string | null | undefined): string | null {
  if (!texto) return null
  const t = texto.trim()
  let m: RegExpExecArray | null

  // 2028-05-14
  if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t))) return armar(+m[1], +m[2], +m[3])
  // 14-05-2028
  if ((m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t))) return armar(+m[3], +m[2], +m[1])
  // 2028-05 y 05-2028 → vence al cierre de mayo
  if ((m = /^(\d{4})[-/](\d{1,2})$/.exec(t)))              return finDeMes(+m[1], +m[2])
  if ((m = /^(\d{1,2})[-/](\d{4})$/.exec(t)))              return finDeMes(+m[2], +m[1])
  // 2028 → vence al cierre del año
  if ((m = /^(\d{4})$/.exec(t)))                           return `${m[1]}-12-31`

  return null
}

// Días que faltan para el vencimiento; negativo si ya venció, null si la
// vigencia no se pudo leer como fecha.
export function diasParaVencer(texto: string | null | undefined, hoy = hoyISO()): number | null {
  const fecha = parseVigencia(texto)
  if (!fecha) return null
  const base = new Date(`${hoy}T12:00:00`).getTime()
  const fin  = new Date(`${fecha}T12:00:00`).getTime()
  return Math.round((fin - base) / 86_400_000)
}

export interface EstadoVigencia {
  /** Color Mantine: rojo si ya venció, amarillo si está por vencer. */
  color: 'red' | 'yellow'
  label: string
  dias:  number
  fecha: string
}

// Estado de alerta de una vigencia, o null si no aplica (texto no interpretable
// o vencimiento todavía lejos de la ventana de aviso).
export function estadoVigencia(texto: string | null | undefined, hoy = hoyISO()): EstadoVigencia | null {
  const fecha = parseVigencia(texto)
  if (!fecha) return null
  const dias = diasParaVencer(texto, hoy)!
  if (dias > DIAS_ALERTA_LICENCIA) return null
  if (dias < 0)   return { color: 'red',    dias, fecha, label: `Vencida hace ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''}` }
  if (dias === 0) return { color: 'red',    dias, fecha, label: 'Vence hoy' }
  return            { color: 'yellow', dias, fecha, label: `Vence en ${dias} día${dias !== 1 ? 's' : ''}` }
}
