// Formato único de fecha en toda la app: día primero, como se lee y se dicta
// aquí. El formato del navegador (mm/dd/aaaa de los <input type="date"> en
// inglés) no se usa en ningún campo.
export const FORMATO_FECHA = 'DD/MM/YYYY'
export const PLACEHOLDER_FECHA = 'dd/mm/aaaa'

// Hoy en ISO "YYYY-MM-DD" tomado del reloj local: usar toISOString() cortaría
// por UTC y en México adelantaría un día toda la tarde.
export function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function esDiaReal(anio: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12 || dia < 1) return false
  // Día 0 del mes siguiente = último día de este mes; cubre febrero bisiesto.
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  return dia <= ultimoDia
}

function aIso(anio: number, mes: number, dia: number): string | null {
  if (!esDiaReal(anio, mes, dia)) return null
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

// Un año de dos dígitos se resuelve con pivote: hasta diez años en el futuro se
// entiende como 20xx y el resto como 19xx, para que "12/05/98" sea 1998 (una
// unidad vieja) y "12/05/30" sea 2030 (una vigencia).
function anioCompleto(yy: number): number {
  const limite = (new Date().getFullYear() % 100) + 10
  return yy <= limite ? 2000 + yy : 1900 + yy
}

// Convierte lo que alguien escribe a mano en el ISO "YYYY-MM-DD" que guardan la
// API y la base. Acepta las formas en que realmente se captura —siempre día
// primero— y el ISO que llega de vuelta del servidor:
//   05/03/2026   5-3-26   05.03.2026   05032026   050326   2026-03-05
// Devuelve null si el texto no es un día real del calendario (31/02, mes 13…),
// para poder avisar en vez de guardar basura.
export function parseFechaEscrita(texto: string): string | null {
  const t = (texto ?? '').trim()
  if (!t) return null

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (iso) return aIso(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const separado = /^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2}|\d{4})$/.exec(t)
  if (separado) {
    const anio = separado[3].length === 2 ? anioCompleto(Number(separado[3])) : Number(separado[3])
    return aIso(anio, Number(separado[2]), Number(separado[1]))
  }

  // Teclado numérico: la fecha de corrido, sin separadores.
  const seguido = /^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(t)
  if (seguido) {
    const anio = seguido[3].length === 2 ? anioCompleto(Number(seguido[3])) : Number(seguido[3])
    return aIso(anio, Number(seguido[2]), Number(seguido[1]))
  }

  return null
}

// Para los mensajes de error de rango: ISO -> dd/mm/aaaa.
export function formatearFecha(iso: string): string {
  const [anio, mes, dia] = iso.split('T')[0].split('-')
  return `${dia}/${mes}/${anio}`
}
