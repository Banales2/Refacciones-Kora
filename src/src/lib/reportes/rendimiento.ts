// Reporte de rendimiento de combustible.
//
// Cada unidad se compara contra su *familia*: la marca y el nombre del modelo
// sin el año, con todos los tractocamiones juntos sin importar la marca. La
// familia la decide la API (`familiaDe` en costosService) y llega en cada
// vehículo, para que este reporte, la pestaña Costos y la alerta de
// rendimiento bajo midan contra lo mismo.
//
// Con la familia como vara se contestan tres preguntas, cada una midiendo a
// un grupo contra *el resto* de su familia (no contra el promedio que lo
// incluye, que lo jala hacia sí mismo y disimula la diferencia):
//   - ¿qué unidad rinde menos que sus hermanas?
//   - ¿influye la sucursal?  la familia en una sucursal contra la misma
//     familia en las demás.
//   - ¿influye el año?  los de un año contra los de los otros años.
//
// Todo se mide sumando km y litros de los tramos entre cargas, nunca
// promediando km/L: una unidad que casi no se movió no pesa lo que una que no
// paró. Una unidad entra si el análisis le pudo medir rendimiento (al menos 3
// tramos completos en el periodo).
import type { AnalisisCostos, VehiculoCosto } from '../../hooks/useDashboard'
import { crearReportePdf, COLOR, type CellHookData } from './pdfDoc'
import { crearLibroExcel } from './excelDoc'
import { formatMXN, formatNum, formatLitros, formatFecha } from '../formato'
import { TIPO_LABELS } from '../tipoVehiculo'

/** Qué tan abajo del resto de su familia tiene que estar una unidad para pintarse de rojo. */
const BAJO_PCT = -15
/** …y de naranja. */
const ALERTA_PCT = -5

/**
 * Las cajas no queman combustible y el montacargas mide horas, no km: su
 * "km/L" sería horas por litro y no se puede poner junto al de nadie.
 */
const TIPOS_FUERA = new Set(['caja_trailer', 'montacargas'])

const SIN_BASE = 'Sin base fija'
const SIN_ANIO = 'Sin año'

function nombreFamilia(v: VehiculoCosto): string {
  return v.tipo === 'tractocamion' ? 'Tractocamiones (todas las marcas)' : v.familia
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Medida {
  unidades: number
  tramos:   number
  km:       number
  litros:   number
}

function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null
}

/** % del grupo contra el resto de su familia. Null si no hay resto. */
function contraResto(grupo: Medida, familia: Medida): number | null {
  const propio = ratio(grupo.km, grupo.litros)
  const resto  = ratio(familia.km - grupo.km, familia.litros - grupo.litros)
  if (propio == null || resto == null || resto <= 0 || familia.unidades - grupo.unidades < 1) return null
  return (propio / resto - 1) * 100
}

export interface UnidadRendimiento {
  v:              VehiculoCosto
  rendimiento:    number
  /** Contra las demás unidades de su familia. Null si es la única. */
  vs_familia_pct: number | null
  /** Pesos al año que se van por rendir menos que sus hermanas. Solo si rinde menos. */
  sobrecosto_anual: number | null
}

export interface SubgrupoRendimiento extends Medida {
  etiqueta:    string
  rendimiento: number | null
  /** Contra el resto de la familia (otras sucursales u otros años). */
  vs_resto_pct: number | null
}

export interface FamiliaRendimiento extends Medida {
  clave:       string
  nombre:      string
  tipo:        string
  rendimiento: number | null
  /** Las unidades medidas, de la que rinde más a la que rinde menos. */
  medidas:     UnidadRendimiento[]
  /** Unidades de la familia con movimiento pero sin tramos suficientes para medirlas. */
  sin_medir:   VehiculoCosto[]
  /** Cuánto rinde la mejor por encima de la peor, en %. Null con menos de dos. */
  dispersion_pct: number | null
  por_sucursal: SubgrupoRendimiento[]
  por_anio:     SubgrupoRendimiento[]
  sobrecosto_anual: number
}

export interface SucursalRendimiento {
  sucursal:  string
  unidades:  number
  /** Las que tienen hermanas de su familia en otra sucursal: con las que se compara. */
  comparables: number
  /** km/L a secas. Mezcla familias: no es lo que se compara. */
  rendimiento: number | null
  /**
   * Qué tanto rinden sus unidades contra las de su misma familia en las otras
   * sucursales. Es lo comparable: una sucursal con camionetas siempre tiene
   * mejor km/L que una con camiones. Negativo = gastan de más.
   */
  eficiencia_pct: number | null
  sobrecosto_anual: number
}

export interface ReporteRendimiento {
  rango:      AnalisisCostos['rango']
  familias:   FamiliaRendimiento[]
  sucursales: SucursalRendimiento[]
  /** Unidades medidas en total, y las que tuvieron movimiento sin poder medirse. */
  medidas:    number
  sin_medir:  number
}

// ─── Cálculo ─────────────────────────────────────────────────────────────────

function nuevaMedida(): Medida {
  return { unidades: 0, tramos: 0, km: 0, litros: 0 }
}

function sumar(m: Medida, v: VehiculoCosto) {
  m.unidades += 1
  m.tramos   += v.tramos
  m.km       += v.tramo_km
  m.litros   += v.tramo_litros
}

function subgrupos(
  medidas: UnidadRendimiento[], familia: Medida, etiquetaDe: (v: VehiculoCosto) => string,
): SubgrupoRendimiento[] {
  const map = new Map<string, Medida>()
  for (const u of medidas) {
    const k = etiquetaDe(u.v)
    const m = map.get(k) ?? nuevaMedida()
    sumar(m, u.v)
    map.set(k, m)
  }
  return [...map.entries()]
    .map(([etiqueta, m]) => ({
      etiqueta, ...m,
      rendimiento:  ratio(m.km, m.litros),
      vs_resto_pct: contraResto(m, familia),
    }))
    .sort((a, b) => (b.rendimiento ?? 0) - (a.rendimiento ?? 0))
}

const sucursalDe = (v: VehiculoCosto) => v.sucursal ?? SIN_BASE
const anioDe     = (v: VehiculoCosto) => v.modelo_anio?.trim() || SIN_ANIO

export function calcularRendimiento(a: AnalisisCostos): ReporteRendimiento {
  const anualizar = 365 / Math.max(1, a.rango.dias)

  const grupos = new Map<string, { nombre: string; tipo: string; medibles: VehiculoCosto[]; sin_medir: VehiculoCosto[] }>()
  for (const v of a.vehiculos) {
    if (TIPOS_FUERA.has(v.tipo)) continue
    // Sin cargas, la unidad salió en el análisis por un servicio o una caseta:
    // no es que no se le pudiera medir, es que no hay nada que medir.
    if (v.rendimiento == null && v.recargas === 0) continue
    const k = v.familia_clave
    const g = grupos.get(k) ?? { nombre: nombreFamilia(v), tipo: v.tipo, medibles: [], sin_medir: [] }
    if (v.rendimiento != null && v.tramo_litros > 0) g.medibles.push(v)
    else g.sin_medir.push(v)
    grupos.set(k, g)
  }

  const familias: FamiliaRendimiento[] = []
  // Por sucursal, a lo largo de todas las familias. `_ideales` son los litros
  // que habrían gastado al rendimiento de su familia en las otras sucursales.
  const porSucursal = new Map<string, SucursalRendimiento & { _km: number; _litros: number; _efLitros: number; _ideales: number }>()

  for (const [clave, g] of grupos) {
    const total = nuevaMedida()
    for (const v of g.medibles) sumar(total, v)

    // Lo que rinde cada sucursal de la familia, para medir a cada unidad
    // contra las de su familia en OTRAS sucursales.
    const sucFam = new Map<string, Medida>()
    for (const v of g.medibles) {
      const m = sucFam.get(sucursalDe(v)) ?? nuevaMedida()
      sumar(m, v)
      sucFam.set(sucursalDe(v), m)
    }

    // La unidad contra las demás de su familia ya viene de la API (es lo mismo
    // que ve la pestaña Costos): aquí solo se agrupa.
    const medidas: UnidadRendimiento[] = g.medibles.map((v) => ({
      v,
      rendimiento:      v.tramo_km / v.tramo_litros,
      vs_familia_pct:   v.desviacion_pct,
      sobrecosto_anual: v.sobrecosto_anual,
    })).sort((x, y) => y.rendimiento - x.rendimiento)

    for (const u of medidas) {
      const nombre = sucursalDe(u.v)
      const s = porSucursal.get(nombre) ?? {
        sucursal: nombre, unidades: 0, comparables: 0, rendimiento: null, eficiencia_pct: null,
        sobrecosto_anual: 0, _km: 0, _litros: 0, _efLitros: 0, _ideales: 0,
      }
      s.unidades += 1
      s._km      += u.v.tramo_km
      s._litros  += u.v.tramo_litros
      const propia = sucFam.get(nombre)!
      const otras = ratio(total.km - propia.km, total.litros - propia.litros)
      if (otras != null && otras > 0) {
        s.comparables += 1
        s._efLitros   += u.v.tramo_litros
        s._ideales    += u.v.tramo_km / otras
        const precio = ratio(u.v.combustible, u.v.litros)
        const extra = u.v.tramo_litros - u.v.tramo_km / otras
        // Como en el análisis de costos, el sobrecosto de la sucursal neta lo
        // que unas unidades gastan de más con lo que otras ahorran.
        if (precio != null) s.sobrecosto_anual += extra * precio * anualizar
      }
      porSucursal.set(nombre, s)
    }

    const mejor = medidas[0]?.rendimiento
    const peor  = medidas[medidas.length - 1]?.rendimiento
    familias.push({
      clave, nombre: g.nombre, tipo: g.tipo, ...total,
      rendimiento: ratio(total.km, total.litros),
      medidas,
      sin_medir: g.sin_medir,
      dispersion_pct: medidas.length >= 2 && peor! > 0 ? (mejor! / peor! - 1) * 100 : null,
      por_sucursal: subgrupos(medidas, total, sucursalDe),
      por_anio:     subgrupos(medidas, total, anioDe),
      sobrecosto_anual: medidas.reduce((s, u) => s + (u.sobrecosto_anual ?? 0), 0),
    })
  }

  // Las de más kilómetros arriba: son las que más pesan en el gasto. Las que
  // no tienen ninguna unidad medida, al final.
  familias.sort((x, y) => y.km - x.km || x.nombre.localeCompare(y.nombre, 'es-MX'))

  const sucursales: SucursalRendimiento[] = [...porSucursal.values()]
    .map(({ _km, _litros, _efLitros, _ideales, ...s }) => ({
      ...s,
      rendimiento:    ratio(_km, _litros),
      eficiencia_pct: _efLitros > 0 ? (_ideales / _efLitros - 1) * 100 : null,
    }))
    // "Sin base fija" no es una sucursal más: va al final.
    .sort((x, y) =>
      Number(x.sucursal === SIN_BASE) - Number(y.sucursal === SIN_BASE)
      || Number(x.eficiencia_pct == null) - Number(y.eficiencia_pct == null)
      || (y.eficiencia_pct ?? 0) - (x.eficiencia_pct ?? 0))

  return {
    rango: a.rango,
    familias,
    sucursales,
    medidas:   familias.reduce((s, f) => s + f.medidas.length, 0),
    sin_medir: familias.reduce((s, f) => s + f.sin_medir.length, 0),
  }
}

// ─── Formato ─────────────────────────────────────────────────────────────────

function ultimoDia(r: AnalisisCostos['rango']): string {
  const d = new Date(`${r.end}T12:00:00`)
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function subtitulo(r: AnalisisCostos['rango']): string {
  return `Del ${formatFecha(r.start)} al ${formatFecha(ultimoDia(r))} · ${r.dias} días`
}

function nombreArchivo(r: AnalisisCostos['rango']): string {
  return `rendimiento-${r.start}_${ultimoDia(r)}`
}

function kmL(n: number | null): string {
  return n != null ? n.toFixed(2) : '—'
}

function pct(n: number | null): string {
  if (n == null) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

function pesos(n: number | null): string {
  return n != null && n > 0 ? formatMXN(Math.round(n)) : '—'
}

/** Pinta la columna `col` (un "%") según qué tan abajo está. */
function colorearPct(col: number) {
  return (d: CellHookData) => {
    if (d.section !== 'body' || d.column.index !== col) return
    const n = parseFloat(String(d.cell.raw).replace('%', ''))
    if (Number.isNaN(n)) return
    if (n <= BAJO_PCT) { d.cell.styles.textColor = COLOR.rojo; d.cell.styles.fontStyle = 'bold' }
    else if (n < ALERTA_PCT) d.cell.styles.textColor = COLOR.naranja
    else if (n >= -ALERTA_PCT) d.cell.styles.textColor = COLOR.verde
  }
}

const NOTA_COMPARACION =
  'Cada familia junta la marca y el modelo sin importar el año (todos los Isuzu ELF 100 juntos), y los ' +
  'tractocamiones van todos en una sola, sin importar la marca. Cada unidad, sucursal o año se mide contra el ' +
  'resto de su familia, no contra un promedio que la incluye. El km/L sale de los tramos completos entre dos ' +
  'cargas con kilometraje (mínimo 3 por unidad). Las cajas y los montacargas no entran: unas no cargan ' +
  'combustible y los otros miden horas, no kilómetros.'

const NOTA_SUCURSAL =
  'Una sucursal se mide contra las mismas familias en las otras sucursales, así que tener camionetas o ' +
  'camiones no la favorece. La diferencia junta todo lo que cambia de un lugar a otro —rutas, carga, ' +
  'choferes, la gasolinera de la zona— y no dice cuál de ellas pesa. Con una o dos unidades comparables, la ' +
  'diferencia puede ser de esas unidades y no de la sucursal. Las unidades sin base fija (tractocamiones, ' +
  'sucursal múltiple) no tienen contra quién.'

// ─── PDF ─────────────────────────────────────────────────────────────────────

export async function exportRendimientoPdf(a: AnalisisCostos) {
  const r = calcularRendimiento(a)
  const pdf = await crearReportePdf({
    titulo: 'Rendimiento de combustible de la flota',
    subtitulo: subtitulo(r.rango),
    orientacion: 'landscape',
  })

  pdf.nota(NOTA_COMPARACION)

  if (r.familias.length === 0) {
    pdf.vacio('Ninguna unidad tuvo cargas con kilometraje en el periodo.')
    pdf.guardar(nombreArchivo(r.rango))
    return
  }

  // ── Familias ──
  pdf.seccion(
    'Por familia',
    'La dispersión es cuánto rinde la mejor unidad de la familia por encima de la peor: ' +
    'una familia pareja anda abajo del 10 %.',
  )
  pdf.tabla({
    head: ['Familia', 'Tipo', 'Unidades', 'Sin medir', 'Km', 'Litros', 'km/L', 'Mejor', 'Peor', 'Dispersión', 'Sobrecosto anual'],
    body: r.familias.map((f) => [
      f.nombre, TIPO_LABELS[f.tipo] ?? f.tipo, String(f.medidas.length), String(f.sin_medir.length),
      formatNum(f.km), formatLitros(f.litros), kmL(f.rendimiento),
      kmL(f.medidas[0]?.rendimiento ?? null), kmL(f.medidas.at(-1)?.rendimiento ?? null),
      f.dispersion_pct != null ? `${f.dispersion_pct.toFixed(0)}%` : '—',
      pesos(f.sobrecosto_anual),
    ]),
    columnStyles: {
      2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' },
      6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' },
    },
    fontSize: 9,
  })
  pdf.nota(
    'El sobrecosto anual es lo que las unidades que rinden menos que sus hermanas gastan de más, al precio ' +
    'que paga cada una el litro, llevado a un año con el ritmo del periodo.',
  )

  // ── Sucursales ──
  pdf.seccion('¿Influye la sucursal?', NOTA_SUCURSAL)
  pdf.tabla({
    head: ['Sucursal', 'Unidades', 'Comparables', 'km/L (mezcla)', 'Contra su familia en otras sucursales', 'Sobrecosto anual'],
    body: r.sucursales.map((s) => [
      s.sucursal, String(s.unidades), String(s.comparables), kmL(s.rendimiento), pct(s.eficiencia_pct),
      pesos(s.sobrecosto_anual),
    ]),
    columnStyles: {
      1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
    },
    didParseCell: colorearPct(4),
  })

  const conVariasSucursales = r.familias.filter((f) => f.por_sucursal.length >= 2)
  if (conVariasSucursales.length > 0) {
    pdf.subseccion('Cada familia, sucursal por sucursal')
    pdf.tabla({
      head: ['Familia', 'Sucursal', 'Unidades', 'Km', 'km/L', 'Contra la familia en las demás'],
      body: conVariasSucursales.flatMap((f) => f.por_sucursal.map((s, i) => [
        i === 0 ? f.nombre : '', s.etiqueta, String(s.unidades), formatNum(s.km), kmL(s.rendimiento), pct(s.vs_resto_pct),
      ])),
      columnStyles: { 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      didParseCell: colorearPct(5),
      fontSize: 9,
    })
  }

  // ── Años ──
  const conVariosAnios = r.familias.filter((f) => f.por_anio.length >= 2)
  pdf.seccion(
    '¿Influye el año?',
    'Los de un año contra los de los otros años de la misma familia. Igual que con la sucursal, con pocas ' +
    'unidades por año la diferencia puede ser de esas unidades y no del año.',
  )
  if (conVariosAnios.length === 0) {
    pdf.vacio('Ninguna familia tiene unidades medidas de más de un año.')
  } else {
    pdf.tabla({
      head: ['Familia', 'Año', 'Unidades', 'Km', 'km/L', 'Contra los otros años'],
      body: conVariosAnios.flatMap((f) => f.por_anio.map((s, i) => [
        i === 0 ? f.nombre : '', s.etiqueta, String(s.unidades), formatNum(s.km), kmL(s.rendimiento), pct(s.vs_resto_pct),
      ])),
      columnStyles: { 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      didParseCell: colorearPct(5),
      fontSize: 9,
    })
  }

  // ── Unidad por unidad ──
  pdf.seccion(
    'Unidad por unidad',
    `En rojo las que rinden ${Math.abs(BAJO_PCT)} % o más abajo que las demás de su familia: casi siempre es algo ` +
    'mecánico, una fuga o cargas que no se fueron a su tanque.',
  )
  for (const f of r.familias) {
    pdf.subseccion(`${f.nombre} · ${kmL(f.rendimiento)} km/L`)
    if (f.medidas.length === 0) {
      pdf.vacio('Ninguna unidad con tramos suficientes para medirla.')
    } else {
      pdf.tabla({
        head: ['Unidad', 'Año', 'Sucursal', 'Tramos', 'Km', 'Litros', 'km/L', 'Contra su familia', 'Sobrecosto anual'],
        body: f.medidas.map((u) => [
          u.v.vehiculo, anioDe(u.v), sucursalDe(u.v), String(u.v.tramos), formatNum(u.v.tramo_km),
          formatLitros(u.v.tramo_litros), kmL(u.rendimiento), pct(u.vs_familia_pct), pesos(u.sobrecosto_anual),
        ]),
        columnStyles: {
          3: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' },
          7: { halign: 'right' }, 8: { halign: 'right' },
        },
        didParseCell: colorearPct(7),
        fontSize: 9,
      })
    }
    if (f.sin_medir.length > 0) {
      pdf.nota(
        `Sin medir (menos de 3 tramos con kilometraje): ${f.sin_medir.map((v) => v.vehiculo).join(', ')}.`,
      )
    }
  }

  pdf.guardar(nombreArchivo(r.rango))
}

// ─── Excel ───────────────────────────────────────────────────────────────────

export async function exportRendimientoExcel(a: AnalisisCostos) {
  const r = calcularRendimiento(a)
  const wb = await crearLibroExcel()

  wb.hojaResumen('Resumen', [
    ['Periodo analizado', `Del ${formatFecha(r.rango.start)} al ${formatFecha(ultimoDia(r.rango))} (${r.rango.dias} días)`],
    ['Familias', r.familias.length],
    ['Unidades medidas', r.medidas],
    ['Unidades sin tramos suficientes', r.sin_medir],
    ['', ''],
    ['Cómo se compara', NOTA_COMPARACION],
    ['Sucursales', NOTA_SUCURSAL],
  ])

  wb.hoja('Familias', [
    { header: 'Familia',          width: 34, valor: (f) => f.nombre },
    { header: 'Tipo',             width: 20, valor: (f) => TIPO_LABELS[f.tipo] ?? f.tipo },
    { header: 'Unidades',         width: 10, formato: 'numero',  valor: (f) => f.medidas.length },
    { header: 'Sin medir',        width: 10, formato: 'numero',  valor: (f) => f.sin_medir.length },
    { header: 'Tramos',           width: 10, formato: 'numero',  valor: (f) => f.tramos },
    { header: 'Km',               width: 12, formato: 'numero',  valor: (f) => f.km },
    { header: 'Litros',           width: 12, formato: 'litros',  valor: (f) => f.litros },
    { header: 'km/L',             width: 10, formato: 'decimal', valor: (f) => f.rendimiento },
    { header: 'Mejor km/L',       width: 12, formato: 'decimal', valor: (f) => f.medidas[0]?.rendimiento ?? null },
    { header: 'Peor km/L',        width: 12, formato: 'decimal', valor: (f) => f.medidas.at(-1)?.rendimiento ?? null },
    { header: 'Dispersión %',     width: 13, formato: 'porcentaje', valor: (f) => f.dispersion_pct },
    { header: 'Sobrecosto anual', width: 16, formato: 'moneda',  valor: (f) => f.sobrecosto_anual },
  ], r.familias, { vacio: 'Ninguna unidad tuvo cargas con kilometraje en el periodo.' })

  wb.hoja('Sucursales', [
    { header: 'Sucursal',          width: 24, valor: (s) => s.sucursal },
    { header: 'Unidades',          width: 10, formato: 'numero',  valor: (s) => s.unidades },
    { header: 'Comparables',       width: 12, formato: 'numero',  valor: (s) => s.comparables },
    { header: 'km/L (mezcla)',     width: 13, formato: 'decimal', valor: (s) => s.rendimiento },
    { header: 'Contra su familia en otras sucursales %', width: 22, formato: 'porcentaje', valor: (s) => s.eficiencia_pct },
    { header: 'Sobrecosto anual',  width: 16, formato: 'moneda',  valor: (s) => Math.max(0, s.sobrecosto_anual) },
  ], r.sucursales, { vacio: 'Sin unidades medidas.' })

  type FilaSub = SubgrupoRendimiento & { familia: string }
  const sub = (f: FamiliaRendimiento, l: SubgrupoRendimiento[]): FilaSub[] => l.map((s) => ({ ...s, familia: f.nombre }))
  const columnasSub = (titulo: string, contra: string) => [
    { header: 'Familia',  width: 34, valor: (s: FilaSub) => s.familia },
    { header: titulo,     width: 22, valor: (s: FilaSub) => s.etiqueta },
    { header: 'Unidades', width: 10, formato: 'numero'  as const, valor: (s: FilaSub) => s.unidades },
    { header: 'Km',       width: 12, formato: 'numero'  as const, valor: (s: FilaSub) => s.km },
    { header: 'Litros',   width: 12, formato: 'litros'  as const, valor: (s: FilaSub) => s.litros },
    { header: 'km/L',     width: 10, formato: 'decimal' as const, valor: (s: FilaSub) => s.rendimiento },
    { header: contra,     width: 20, formato: 'porcentaje' as const, valor: (s: FilaSub) => s.vs_resto_pct },
  ]

  wb.hoja('Familia por sucursal', columnasSub('Sucursal', 'Contra las demás %'),
    r.familias.flatMap((f) => sub(f, f.por_sucursal)), { vacio: 'Sin unidades medidas.' })

  wb.hoja('Familia por año', columnasSub('Año', 'Contra los otros años %'),
    r.familias.flatMap((f) => sub(f, f.por_anio)), { vacio: 'Sin unidades medidas.' })

  type FilaUnidad = UnidadRendimiento & { familia: string }
  wb.hoja('Unidades', [
    { header: 'Familia',            width: 34, valor: (u) => u.familia },
    { header: 'Unidad',             width: 36, valor: (u) => u.v.vehiculo },
    { header: 'Año',                width: 8,  valor: (u) => anioDe(u.v) },
    { header: 'Sucursal',           width: 22, valor: (u) => sucursalDe(u.v) },
    { header: 'Tramos',             width: 9,  formato: 'numero',  valor: (u) => u.v.tramos },
    { header: 'Km',                 width: 12, formato: 'numero',  valor: (u) => u.v.tramo_km },
    { header: 'Litros',             width: 12, formato: 'litros',  valor: (u) => u.v.tramo_litros },
    { header: 'km/L',               width: 10, formato: 'decimal', valor: (u) => u.rendimiento },
    { header: 'Contra su familia %',width: 18, formato: 'porcentaje', valor: (u) => u.vs_familia_pct },
    { header: 'Sobrecosto anual',   width: 16, formato: 'moneda',  valor: (u) => u.sobrecosto_anual },
  ], r.familias.flatMap((f): FilaUnidad[] => f.medidas.map((u) => ({ ...u, familia: f.nombre }))),
  { vacio: 'Sin unidades medidas.' })

  await wb.guardar(nombreArchivo(r.rango))
}
