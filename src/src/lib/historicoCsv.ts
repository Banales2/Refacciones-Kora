// Del CSV del proveedor a las facturas que la API sabe importar.
//
// El archivo es una exportación: un renglón por partida, con el folio y la
// fecha repetidos en cada uno. Aquí se agrupa por folio —que es lo que vuelve a
// hacer de esos renglones una factura—, se limpia cada campo con las mismas
// allowlists que valida el backend, y lo que no se puede leer se aparta en vez
// de tumbar el archivo entero.
//
// Ver `docs/importacion-historica.md`.
import { normalizarEncabezado, parseCsv } from './csv'
import { limpiarCodigo, limpiarTextoLibre, limpiarFolio, normalizarFolio } from './validaciones'

/** Cómo vienen escritas las fechas del archivo. Ver `detectarFormatoFecha`. */
export type FormatoFecha = 'MDA' | 'DMA'

export interface RenglonHistorico {
  /** Línea del archivo, para poder ir a verla. La 1 es el encabezado. */
  linea:          number
  numero_serie:   string
  descripcion:    string
  cantidad:       number
  costo_unitario: number
}

export interface FacturaHistorica {
  num_factura:  string
  /** YYYY-MM-DD. */
  fecha_compra: string
  renglones:    RenglonHistorico[]
}

export interface LineaRechazada {
  linea:  number
  motivo: string
  /** El renglón tal como venía, para reconocerlo en el archivo. */
  texto:  string
}

export interface ArchivoHistorico {
  facturas:  FacturaHistorica[]
  /** Renglones que no se pudieron leer. No entran en las facturas. */
  rechazos:  LineaRechazada[]
  /** Una entrada por número de parte distinto, con la descripción del archivo. */
  articulos: { numero_serie: string; descripcion: string; renglones: number }[]
  formato:   FormatoFecha
  /** Total de renglones que sí se leyeron. */
  renglones: number
}

// Cómo se puede llamar cada columna. La primera es la del archivo que motivó
// esto; las demás son los nombres con los que el mismo dato sale de otros
// sistemas. Se comparan ya normalizados (sin acentos, en minúsculas).
const COLUMNAS = {
  folio:  ['movimiento', 'folio', 'factura', 'num factura', 'no factura', 'documento'],
  fecha:  ['fecha emision', 'fecha', 'fecha factura', 'fecha compra'],
  serie:  ['articulo', 'numero de parte', 'no parte', 'parte', 'codigo', 'sku', 'numero de serie'],
  desc:   ['descripcion', 'descripcion articulo', 'concepto'],
  cant:   ['cantidad', 'cant', 'piezas'],
  costo:  ['precio unit con descuento', 'precio unitario', 'precio', 'costo unitario', 'costo', 'importe unitario'],
} as const

export type Columna = keyof typeof COLUMNAS

/** Cómo se llama cada columna en pantalla cuando falta. */
export const NOMBRE_COLUMNA: Record<Columna, string> = {
  folio: 'Movimiento (folio)',
  fecha: 'Fecha',
  serie: 'Artículo',
  desc:  'Descripción',
  cant:  'Cantidad',
  costo: 'Precio unitario',
}

export class ArchivoInvalidoError extends Error {}

function mapearColumnas(encabezado: string[]): Record<Columna, number> {
  const normalizados = encabezado.map(normalizarEncabezado)
  const mapa = {} as Record<Columna, number>
  const faltantes: Columna[] = []

  for (const clave of Object.keys(COLUMNAS) as Columna[]) {
    const i = normalizados.findIndex((h) => (COLUMNAS[clave] as readonly string[]).includes(h))
    if (i === -1) faltantes.push(clave)
    else mapa[clave] = i
  }

  if (faltantes.length) {
    throw new ArchivoInvalidoError(
      `El archivo no trae la columna ${faltantes.map((c) => NOMBRE_COLUMNA[c]).join(', ')}. ` +
      `Encontradas: ${encabezado.filter((h) => h.trim()).join(', ')}`,
    )
  }
  return mapa
}

/**
 * Si el archivo trae las fechas como mes/día o día/mes.
 *
 * No se puede saber renglón por renglón: "1/5/2026" es válido de las dos
 * formas, y adivinar mal mueve una compra cuatro meses. Pero el archivo entero
 * sí lo dice — basta con que UNA fecha tenga un primer número mayor que 12
 * ("7/14/2026" no puede ser día/mes) para que todo el archivo quede decidido.
 *
 * Sin ninguna pista se asume mes/día, que es como exporta la mayoría de los
 * sistemas de facturación, y la pantalla deja cambiarlo: el que sube el archivo
 * lo tiene abierto y sabe cuál es.
 */
export function detectarFormatoFecha(filas: string[][], col: number): FormatoFecha {
  let hayDiaPrimero = false
  let haySegundoMayorA12 = false
  for (const fila of filas) {
    const partes = (fila[col] ?? '').trim().split(/[/-]/)
    if (partes.length !== 3) continue
    const a = Number(partes[0])
    const b = Number(partes[1])
    if (a > 12 && a <= 31) hayDiaPrimero = true
    if (b > 12 && b <= 31) haySegundoMayorA12 = true
  }
  // Si las dos cosas pasan, el archivo se contradice: gana mes/día, que es el
  // formato en que ese caso se produce por un renglón mal capturado.
  if (hayDiaPrimero && !haySegundoMayorA12) return 'DMA'
  return 'MDA'
}

/** "7/14/2026" -> "2026-07-14". Devuelve null si no se puede leer. */
function aIso(valor: string, formato: FormatoFecha): string | null {
  const texto = valor.trim()
  // Ya viene ISO: hay exportaciones que lo hacen y no hay nada que interpretar.
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10)

  const partes = texto.split(/[/-]/)
  if (partes.length !== 3) return null
  const [p1, p2, p3] = partes.map((x) => Number(x))
  if (!Number.isInteger(p1) || !Number.isInteger(p2) || !Number.isInteger(p3)) return null

  const anio = p3 < 100 ? 2000 + p3 : p3
  const mes = formato === 'MDA' ? p1 : p2
  const dia = formato === 'MDA' ? p2 : p1
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || anio < 1900 || anio > 2999) return null

  const iso = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
  // Un 31 de febrero pasa los rangos de arriba pero no existe; el Date lo caza.
  const d = new Date(`${iso}T12:00:00`)
  if (d.getMonth() + 1 !== mes || d.getDate() !== dia) return null
  return iso
}

/**
 * "  6,481.58 " -> 6481.58. Devuelve null si no queda un número usable.
 *
 * Entran igual "6,481.58" y "6.481,58": el mismo sistema exporta de las dos
 * formas según cómo esté configurado el Windows de quien lo corre, y quitar las
 * comas a ciegas convertía 6.481,58 en 6.48158.
 *
 * La regla es la del último separador, con una excepción que importa: si lo
 * único que queda a su derecha son exactamente tres dígitos y no hay otro
 * separador de por medio, es de miles y no decimal. Sin ella "1,566" —una
 * cantidad o un precio cerrado— se leía como 1.566.
 */
function aNumero(valor: string): number | null {
  const solo = valor.replace(/[^0-9.,-]/g, '')
  if (solo === '') return null

  const corte = Math.max(solo.lastIndexOf('.'), solo.lastIndexOf(','))
  const separadores = (solo.match(/[.,]/g) ?? []).length
  const cola = corte === -1 ? '' : solo.slice(corte + 1)
  const esDecimal =
    corte !== -1 &&
    // Con dos separadores distintos el último manda: "6,481.58" / "6.481,58".
    (separadores === 1 ? !/^\d{3}$/.test(cola) : new Set(solo.match(/[.,]/g)).size > 1)

  const limpio = esDecimal
    ? `${solo.slice(0, corte).replace(/[.,]/g, '')}.${cola.replace(/[^0-9]/g, '')}`
    : solo.replace(/[.,]/g, '')
  if (!/\d/.test(limpio)) return null
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}

/**
 * Quita las comillas que envuelven una descripción entera.
 *
 * No son del dato: son del sistema que exportó el archivo, que ya traía la
 * descripción entrecomillada y volvió a entrecomillarla al escribir el CSV. El
 * lector deshace una capa y la otra queda dentro del texto, así que
 * `"LENTE;TRASERA Y STOP,"` acabaría en el catálogo con las comillas puestas.
 * Solo se quitan de los extremos y solo si están las dos: una comilla en medio
 * («llave de 1/2"») es parte de la descripción.
 */
function sinComillasDeSobra(texto: string): string {
  let v = texto.trim()
  while (v.length > 1 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).trim()
  return v
}

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Lee el archivo completo. `formato` fuerza cómo se interpretan las fechas; sin
 * él se detecta (ver `detectarFormatoFecha`).
 *
 * Un renglón ilegible no tumba el archivo: se aparta en `rechazos` con el
 * motivo y el número de línea. Con doscientos renglones exportados de otro
 * sistema, rechazar todo por uno roto significa que nadie importa nunca nada.
 */
export function leerArchivoHistorico(
  texto: string, formato?: FormatoFecha,
): ArchivoHistorico {
  const filas = parseCsv(texto)
  if (filas.length === 0) throw new ArchivoInvalidoError('El archivo está vacío')

  const col = mapearColumnas(filas[0])
  const cuerpo = filas.slice(1)
  if (cuerpo.length === 0) throw new ArchivoInvalidoError('El archivo solo trae el encabezado')

  const fmt = formato ?? detectarFormatoFecha(cuerpo, col.fecha)
  const hoy = hoyIso()

  const rechazos: LineaRechazada[] = []
  const porFolio = new Map<string, FacturaHistorica>()
  const articulos = new Map<string, { numero_serie: string; descripcion: string; renglones: number }>()
  let renglones = 0

  cuerpo.forEach((fila, i) => {
    // +2: la 1 es el encabezado y las líneas se cuentan desde 1, que es como
    // las numera el Excel que el usuario tiene abierto al lado.
    const linea = i + 2
    const crudo = fila.join(', ').trim()
    const rechazar = (motivo: string) => rechazos.push({ linea, motivo, texto: crudo })

    const folio = normalizarFolio(limpiarFolio(fila[col.folio] ?? '', 30))
    if (!folio) return rechazar('Sin folio')

    const fecha = aIso(fila[col.fecha] ?? '', fmt)
    if (!fecha) return rechazar(`Fecha ilegible: "${(fila[col.fecha] ?? '').trim()}"`)
    if (fecha > hoy) return rechazar(`Fecha futura: ${fecha}`)

    const serie = limpiarCodigo(fila[col.serie] ?? '', 20)
    if (!serie) return rechazar('Sin número de artículo')

    const cantidad = aNumero(fila[col.cant] ?? '')
    if (cantidad === null || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 999) {
      return rechazar(`Cantidad inválida: "${(fila[col.cant] ?? '').trim()}"`)
    }

    const costo = aNumero(fila[col.costo] ?? '')
    if (costo === null || costo <= 0 || costo > 200000) {
      return rechazar(`Precio inválido: "${(fila[col.costo] ?? '').trim()}"`)
    }

    // Los saltos de línea dentro de una descripción entrecomillada son reales
    // en estas exportaciones; como texto de catálogo no aportan nada.
    const descripcion =
      limpiarTextoLibre(
        sinComillasDeSobra((fila[col.desc] ?? '').replace(/\s+/g, ' ')), 255,
      ).trim()
        // La descripción solo se usa si la refacción no está en el catálogo, y
        // vacía no pasaría la validación. El número de parte es lo peor que
        // puede quedar y sigue identificando la pieza.
        || serie

    const factura = porFolio.get(folio)
    if (factura) {
      factura.renglones.push({ linea, numero_serie: serie, descripcion, cantidad, costo_unitario: costo })
    } else {
      // La fecha de la factura es la del primer renglón que la nombra. En una
      // exportación los N renglones de un folio traen la misma.
      porFolio.set(folio, {
        num_factura: folio,
        fecha_compra: fecha,
        renglones: [{ linea, numero_serie: serie, descripcion, cantidad, costo_unitario: costo }],
      })
    }

    const art = articulos.get(serie)
    if (art) art.renglones++
    else articulos.set(serie, { numero_serie: serie, descripcion, renglones: 1 })
    renglones++
  })

  return {
    facturas: [...porFolio.values()],
    rechazos,
    articulos: [...articulos.values()].sort((a, b) => a.numero_serie.localeCompare(b.numero_serie)),
    formato: fmt,
    renglones,
  }
}
