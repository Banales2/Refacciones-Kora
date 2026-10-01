// Lectura de la tabla de mantenimiento del fabricante en CSV, para importarla
// como programa de un modelo. Ver `docs/importar-programa.md`.
//
// Son dos archivos por grupo de modelos:
//
//   - Las operaciones, una fila por REGLA: "Aceite de motor, km 15000, R" es
//     una fila y "Aceite de motor, límite 12 meses" es otra. Así entran en el
//     mismo formato tablas con columnas de kilometraje distintas —la del ELF
//     100 va de 5,000 en 15,000 y la del ELF 400 de 10,400 en 10,400—.
//   - Los precios, opcional, una fila por kilometraje: lo que el taller cobra
//     por el servicio completo, que es como se cotiza (migración 014).
//
// Un archivo cubre varios modelos a la vez ("ELF 100;ELF 200;ELF 300") y una
// fila puede aplicar solo a algunos ("ELF 400"). Por eso se arma el programa
// para UN modelo del archivo: el que corresponde al modelo del sistema.
import { parseCsv, normalizarEncabezado } from './csv'
import { limpiarTextoLibre } from './validaciones'

export class ArchivoInvalidoError extends Error {}

/**
 * Los tipos de regla del archivo de operaciones.
 *
 *  - `km`            servicio a esa marca de odómetro: una celda de la tabla.
 *  - `limite_meses`  el "o a los N meses, lo que ocurra primero" del renglón.
 *  - `cada_meses`    la acción se repite cada N meses, sin kilometraje.
 *  - `cada_km`       cada N km por su cuenta, fuera de las columnas (DPD).
 *  - `cada_horas`    cada N horas de motor (DPD).
 */
export type TipoRegla = 'km' | 'limite_meses' | 'cada_meses' | 'cada_km' | 'cada_horas'
const TIPOS: TipoRegla[] = ['km', 'limite_meses', 'cada_meses', 'cada_km', 'cada_horas']

export interface ReglaPrograma {
  modelos:          string[]
  no:               number
  operacion:        string
  condicion_severa: boolean
  si_equipado:      boolean
  indicador:        string
  tipo:             TipoRegla
  valor:            number
  accion:           string
  nota:             string
}

export interface ArchivoPrograma {
  reglas:  ReglaPrograma[]
  /** Los modelos que menciona el archivo, en el orden en que aparecen. */
  modelos: string[]
  /** "2020-2025", o null si el archivo no lo trae. */
  anios:   string | null
}

export interface PrecioServicio {
  modelos: string[]
  km:      number
  precio:  number | null
}

const COLUMNAS_PROGRAMA = [
  'modelos', 'no', 'operacion', 'condicion_severa', 'si_equipado',
  'indicador', 'tipo', 'valor', 'accion', 'nota',
]
const COLUMNAS_PRECIOS = ['modelos', 'km', 'precio']

// Las filas como objetos por encabezado, exigiendo las columnas que se usan.
function leerTabla(texto: string, requeridas: string[]): Record<string, string>[] {
  const filas = parseCsv(texto)
  if (filas.length < 2) throw new ArchivoInvalidoError('El archivo no trae renglones.')
  const encabezado = filas[0].map(normalizarEncabezado)
  const faltan = requeridas.filter((c) => !encabezado.includes(c))
  if (faltan.length) {
    throw new ArchivoInvalidoError(
      `Le faltan las columnas: ${faltan.join(', ')}. ¿Es el archivo correcto?`
    )
  }
  return filas.slice(1).map((f) =>
    Object.fromEntries(encabezado.map((c, i) => [c, (f[i] ?? '').trim()])))
}

function listaDeModelos(valor: string): string[] {
  return valor.split(';').map((m) => m.trim()).filter(Boolean)
}

// "1,234.50", "$1234.5" y " 1234 " son el mismo número: así sale de Excel.
function numero(valor: string): number | null {
  const limpio = valor.replace(/[$,\s]/g, '')
  if (!limpio) return null
  const n = Number(limpio)
  return Number.isFinite(n) ? n : NaN
}

export function leerArchivoPrograma(texto: string): ArchivoPrograma {
  const filas = leerTabla(texto, COLUMNAS_PROGRAMA)
  const reglas: ReglaPrograma[] = []
  const modelos: string[] = []
  let anios: string | null = null

  filas.forEach((f, i) => {
    const renglon = i + 2
    const tipo = f.tipo as TipoRegla
    if (!TIPOS.includes(tipo)) {
      throw new ArchivoInvalidoError(`Renglón ${renglon}: el tipo "${f.tipo}" no se reconoce.`)
    }
    const no = numero(f.no)
    const valor = numero(f.valor)
    if (!no || !Number.isInteger(no)) {
      throw new ArchivoInvalidoError(`Renglón ${renglon}: la columna "no" no es un número.`)
    }
    if (!valor || !Number.isInteger(valor) || valor <= 0) {
      throw new ArchivoInvalidoError(`Renglón ${renglon}: el valor "${f.valor}" no es un número válido.`)
    }
    if (!f.operacion) throw new ArchivoInvalidoError(`Renglón ${renglon}: falta el nombre de la operación.`)
    if ((tipo === 'km' || tipo === 'cada_meses') && !f.accion) {
      throw new ArchivoInvalidoError(`Renglón ${renglon}: la regla "${tipo}" necesita una acción.`)
    }

    const deLaFila = listaDeModelos(f.modelos)
    for (const m of deLaFila) if (!modelos.includes(m)) modelos.push(m)
    if (!anios && f.anio_desde && f.anio_hasta) anios = `${f.anio_desde}-${f.anio_hasta}`

    reglas.push({
      modelos: deLaFila,
      no,
      operacion: f.operacion,
      condicion_severa: f.condicion_severa === '1',
      si_equipado:      f.si_equipado === '1',
      indicador: f.indicador,
      tipo,
      valor,
      accion: f.accion.toUpperCase(),
      nota:   f.nota,
    })
  })

  if (!modelos.length) throw new ArchivoInvalidoError('El archivo no dice a qué modelos aplica.')
  return { reglas, modelos, anios }
}

export function leerArchivoPrecios(texto: string): PrecioServicio[] {
  return leerTabla(texto, COLUMNAS_PRECIOS).map((f, i) => {
    const km = numero(f.km)
    const precio = numero(f.precio)
    if (!km || !Number.isInteger(km) || km <= 0) {
      throw new ArchivoInvalidoError(`Renglón ${i + 2}: el kilometraje "${f.km}" no es válido.`)
    }
    if (precio != null && (Number.isNaN(precio) || precio < 0)) {
      throw new ArchivoInvalidoError(`Renglón ${i + 2}: el precio "${f.precio}" no es válido.`)
    }
    return { modelos: listaDeModelos(f.modelos), km, precio }
  })
}

// "ELF 100", "Elf100" e "ISUZU ELF 100" nombran al mismo modelo.
function claveModelo(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Cuál de los modelos del archivo es el del sistema, si se puede saber por el
 * nombre. Null si ninguno o más de uno encajan: entonces lo elige la persona.
 */
export function modeloDelArchivo(
  modelos: string[], modelo: { marca: string; nombre: string },
): string | null {
  const nombre = claveModelo(modelo.nombre)
  const completo = claveModelo(`${modelo.marca} ${modelo.nombre}`)
  const exacto = modelos.filter((m) => [nombre, completo].includes(claveModelo(m)))
  if (exacto.length === 1) return exacto[0]
  // "ELF 100 Euro V" contiene a "ELF100", pero "ELF 1000" no.
  const contenido = modelos.filter((m) => {
    const k = claveModelo(m)
    const i = completo.indexOf(k)
    return i >= 0 && !/[0-9]/.test(completo[i + k.length] ?? '')
  })
  return contenido.length === 1 ? contenido[0] : null
}

export interface OperacionArmada {
  no:            number
  nombre:        string
  descripcion:   string | null
  limite_meses:  number | null
  celdas:        { km: number; accion: string }[]
  /** Alguna regla del renglón usa estas acciones, en celda o fuera de ella. */
  acciones:      Set<string>
  /**
   * Reglas que el programa no puede seguir solo —cada N km fuera de las
   * columnas, cada N horas, una segunda periodicidad en meses—. Quedan en las
   * notas del renglón, a la vista, pero nadie las va a vencer.
   */
  sinProgramar:  string[]
  /** Un nombre de tipo de pieza para ofrecer, sacado del renglón. */
  sugerenciaTipo: string
}

export interface ProgramaArmado {
  fases:       { km: number; costo: number | null }[]
  operaciones: OperacionArmada[]
  /** Kilometrajes sin precio en el archivo de precios, cuando se dio uno. */
  sinPrecio:   number[]
}

const nf = new Intl.NumberFormat('es-MX')

// "Perno rey de la dirección (modelo con suspensión...)" -> "Perno rey de la
// dirección": lo de los paréntesis aclara el renglón, no nombra la pieza. Y un
// tipo de pieza solo admite letras, números, espacios y guiones, hasta 40.
function sugerirTipo(nombre: string): string {
  let s = nombre.replace(/\([^)]*\)/g, ' ').replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 -]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length > 40) s = s.slice(0, 41).replace(/\s+\S*$/, '')
  return s.slice(0, 40)
}

/**
 * El programa de UN modelo del archivo, ya con la forma del sistema: columnas
 * con su precio y renglones con sus celdas y su límite de meses.
 *
 * Lo que el sistema no modela —una segunda periodicidad en meses, cada N km
 * aparte, cada N horas, el asterisco, "si está equipado", el indicador del
 * tablero— no se pierde: va a las notas del renglón, escrito para leerse.
 */
export function armarPrograma(
  archivo: ArchivoPrograma,
  modelo: string,
  nombreAccion: (codigo: string) => string,
  precios?: PrecioServicio[],
): ProgramaArmado {
  const reglas = archivo.reglas.filter((r) => r.modelos.length === 0 || r.modelos.includes(modelo))

  const marcas = [...new Set(reglas.filter((r) => r.tipo === 'km').map((r) => r.valor))]
    .sort((a, b) => a - b)
  const preciosModelo = (precios ?? []).filter((p) => p.modelos.length === 0 || p.modelos.includes(modelo))
  const fases = marcas.map((km) => ({
    km, costo: preciosModelo.find((p) => p.km === km)?.precio ?? null,
  }))
  const sinPrecio = precios ? fases.filter((f) => f.costo == null).map((f) => f.km) : []

  const porNo = new Map<number, ReglaPrograma[]>()
  for (const r of reglas) {
    const lista = porNo.get(r.no)
    if (lista) lista.push(r)
    else porNo.set(r.no, [r])
  }

  const operaciones = [...porNo.entries()].sort(([a], [b]) => a - b).map(([no, rs]) => {
    const primera = rs[0]
    const celdas = rs.filter((r) => r.tipo === 'km').map((r) => ({ km: r.valor, accion: r.accion }))
    const acciones = new Set(rs.map((r) => r.accion).filter(Boolean))

    // El límite: el "lo que ocurra primero" del renglón y, si el renglón va
    // solo por tiempo, su periodicidad más corta. Las demás periodicidades no
    // caben en el renglón —el sistema lleva un solo límite— y van a las notas.
    const limite = rs.find((r) => r.tipo === 'limite_meses')
    const porMeses = rs.filter((r) => r.tipo === 'cada_meses').sort((a, b) => a.valor - b.valor)
    const limite_meses = limite?.valor ?? porMeses[0]?.valor ?? null

    const accion = (r: ReglaPrograma) => r.accion ? `: ${nombreAccion(r.accion)}` : ''
    const nota = (r: ReglaPrograma) => r.nota ? ` (${r.nota})` : ''
    const notas: string[] = []
    const sinProgramar: string[] = []

    for (const r of porMeses) {
      const texto = `Cada ${r.valor} meses${accion(r)}${nota(r)}.`
      notas.push(texto)
      if (r.valor !== limite_meses) sinProgramar.push(texto)
    }
    for (const r of rs.filter((x) => x.tipo === 'cada_km')) {
      const texto = `Cada ${nf.format(r.valor)} km${accion(r)}${nota(r)}.`
      notas.push(texto)
      sinProgramar.push(texto)
    }
    for (const r of rs.filter((x) => x.tipo === 'cada_horas')) {
      const texto = `Cada ${nf.format(r.valor)} horas de motor${accion(r)}${nota(r)}.`
      notas.push(texto)
      sinProgramar.push(texto)
    }
    if (primera.indicador) notas.push(`${primera.indicador}.`.replace(/\.\.$/, '.'))
    if (primera.si_equipado) notas.push('Solo si la unidad lo tiene equipado.')
    if (primera.condicion_severa) notas.push('Marcada con asterisco en la tabla del fabricante.')

    const descripcion = limpiarTextoLibre(notas.join(' '), 2000).trim() || null
    return {
      no,
      nombre: limpiarTextoLibre(primera.operacion, 200).trim(),
      descripcion,
      limite_meses,
      celdas,
      acciones,
      sinProgramar,
      sugerenciaTipo: sugerirTipo(primera.operacion),
    }
  })

  return { fases, operaciones, sinPrecio }
}
