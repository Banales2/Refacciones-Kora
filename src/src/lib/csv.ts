// Lector de CSV. Escrito a mano y no traído de una librería porque es lo único
// que hace falta —leer un archivo que alguien exportó de su sistema— y una
// dependencia más en el bundle de una app que se usa con internet malo se paga
// en cada carga.
//
// Sigue el CSV de verdad, no el "separar por comas":
//
//   - Un campo entre comillas puede traer comas, saltos de línea y comillas
//     dobladas (`""` es una comilla). El archivo del proveedor trae las tres
//     cosas: descripciones como `"PIN; WHEEL, RR AXLE (R)"` y precios como
//     `" 6,481.58 "`.
//   - Acepta saltos \r\n y \n, y se traga el BOM que Excel pone al inicio.
//
// Separar por comas a secas partía `"NUT;WHEEL, INNER,RR AXLE"` en tres
// columnas y corría el resto del renglón: la descripción acababa en la cantidad
// y el precio en ningún lado.

/**
 * Las filas del texto, cada una como arreglo de campos sin procesar. Las filas
 * totalmente vacías se descartan: un archivo exportado casi siempre termina en
 * una o dos.
 */
export function parseCsv(texto: string): string[][] {
  const filas: string[][] = []
  let fila: string[] = []
  let campo = ''
  let enComillas = false

  // El BOM es parte del primer campo si no se quita, y entonces el encabezado
  // "Movimiento" deja de llamarse "Movimiento".
  const src = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto

  function cerrarCampo() { fila.push(campo); campo = '' }
  function cerrarFila() {
    cerrarCampo()
    if (fila.some((c) => c.trim() !== '')) filas.push(fila)
    fila = []
  }

  for (let i = 0; i < src.length; i++) {
    const c = src[i]

    if (enComillas) {
      if (c !== '"') { campo += c; continue }
      // Comilla dentro de comillas: `""` es una comilla literal, una sola
      // cierra el campo.
      if (src[i + 1] === '"') { campo += '"'; i++; continue }
      enComillas = false
      continue
    }

    if (c === '"' && campo === '') { enComillas = true; continue }
    if (c === ',') { cerrarCampo(); continue }
    if (c === '\r') { if (src[i + 1] === '\n') i++; cerrarFila(); continue }
    if (c === '\n') { cerrarFila(); continue }
    campo += c
  }
  // Lo que quedó sin salto final.
  if (campo !== '' || fila.length) cerrarFila()

  return filas
}

/**
 * Lee el archivo como texto. UTF-8 primero y, si no es UTF-8 válido,
 * windows-1252: es lo que produce el "Guardar como CSV" de Excel en español, y
 * con él las eñes y los acentos de las descripciones llegan enteros en vez de
 * como rombos.
 */
export async function leerTexto(archivo: File): Promise<string> {
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/**
 * Quita acentos y deja minúsculas sin espacios de sobra, para comparar
 * encabezados. "Fecha Emisión" y "FECHA EMISION" son el mismo encabezado, y
 * cuál de los dos exporta el sistema del proveedor no es asunto de quien
 * importa.
 */
export function normalizarEncabezado(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}
