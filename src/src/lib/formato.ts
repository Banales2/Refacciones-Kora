// Formato de números y fechas para pantalla. Vivía duplicado dentro del
// Dashboard; ahora que el tablero está partido en varias pestañas lo comparten
// todas, y así "$1,234.00" se ve igual en cualquiera de ellas.

export function formatMXN(n: number): string {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

// Versión corta para ejes de gráfica y tarjetas, donde "$1,234,567.00" no cabe.
export function formatMXNCorto(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000)    return `$${Math.round(n / 1_000)}k`
  return `$${Math.round(n).toLocaleString('es-MX')}`
}

export function formatNum(n: number, decimales = 0): string {
  return n.toLocaleString('es-MX', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
}

// Los litros se capturan con hasta tres decimales, que es como despacha la
// bomba y como los imprime el ticket. Se muestran completos, sin rellenar de
// ceros más allá de los dos de siempre: 45.678, 45.5 → "45.50". Sin la unidad,
// porque en las tablas va en el encabezado.
export function formatLitros(n: number): string {
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 3 })
}

// Las fechas de la API vienen como 'YYYY-MM-DD'. Se anclan a mediodía porque
// interpretarlas como medianoche UTC las corre un día hacia atrás en México.
function aDate(iso: string): Date {
  return new Date(`${iso.split('T')[0]}T12:00:00`)
}

export function formatFecha(iso: string): string {
  return aDate(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatFechaCorta(iso: string): string {
  return aDate(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
}

// 'YYYY-MM' → 'ene 25'. Es lo que entra en el eje de la gráfica de doce meses
// sin encimarse una etiqueta con otra.
export function formatMes(mes: string): string {
  const [year, month] = mes.split('-').map(Number)
  return new Date(year, month - 1, 15)
    .toLocaleDateString('es-MX', { month: 'short', year: '2-digit' })
    .replace('.', '')
}
