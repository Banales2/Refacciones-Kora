// Reporte de los vales que nadie ha gastado, por sucursal.
//
// Es la lista que se lleva a la sucursal para preguntar por cada papel: quién
// lo tiene y por qué no se ha cargado. Por eso lo perdido va primero y en rojo,
// y dentro de cada sucursal los vales van del más viejo al más nuevo.
//
// "Sin usar" son los vales en estado creado o perdido. Los archivados no: ya
// alguien decidió que no van a aparecer.
import type { ValeGasolina } from '../../hooks/useValesGasolina'
import { ESTADO_VALE } from '../../hooks/useValesGasolina'
import { crearReportePdf, hoyISO, COLOR, type CellHookData } from './pdfDoc'
import { crearLibroExcel } from './excelDoc'
import { formatFecha } from '../formato'

/** Cómo se llama la sucursal de un vale; los de antes de registrarla no tienen. */
export const SIN_SUCURSAL = 'ANTIGUO'

export function sucursalDelVale(v: ValeGasolina): string {
  return v.sucursal ?? SIN_SUCURSAL
}

export function esSinUsar(v: ValeGasolina): boolean {
  return v.estado === 'creado' || v.estado === 'perdido'
}

export interface GrupoSucursal {
  sucursal: string
  vales:    ValeGasolina[]
  perdidos: number
  sinUsar:  number
}

/**
 * Los vales sin usar, agrupados por sucursal y en orden alfabético —ANTIGUO al
 * final: no es una sucursal—. Dentro, del más viejo al más nuevo.
 */
export function agruparPorSucursal(vales: ValeGasolina[]): GrupoSucursal[] {
  const grupos = new Map<string, ValeGasolina[]>()
  for (const v of vales.filter(esSinUsar)) {
    const s = sucursalDelVale(v)
    if (!grupos.has(s)) grupos.set(s, [])
    grupos.get(s)!.push(v)
  }
  return [...grupos.entries()]
    .sort(([a], [b]) =>
      a === SIN_SUCURSAL ? 1 : b === SIN_SUCURSAL ? -1 : a.localeCompare(b, 'es'))
    .map(([sucursal, vs]) => {
      const ordenados = [...vs].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.folio.localeCompare(b.folio))
      const perdidos = ordenados.filter((v) => v.estado === 'perdido').length
      return { sucursal, vales: ordenados, perdidos, sinUsar: ordenados.length - perdidos }
    })
}

function vehiculo(v: ValeGasolina): string {
  return `${v.marca} ${v.modelo}`
}

function dias(v: ValeGasolina): string {
  if (v.dias_sin_usar == null) return '—'
  return v.dias_sin_usar === 0 ? 'Hoy' : String(v.dias_sin_usar)
}

function nombreBase(sucursal: string | null): string {
  const s = sucursal
    ? `-${sucursal.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    : ''
  return `vales-sin-usar${s}-${hoyISO()}`
}

/** `sucursal`: la elegida, o null para todas. */
export async function exportValesSinUsarPdf(vales: ValeGasolina[], sucursal: string | null) {
  const grupos = agruparPorSucursal(vales)
  const total = grupos.reduce((s, g) => s + g.vales.length, 0)
  const perdidos = grupos.reduce((s, g) => s + g.perdidos, 0)

  const pdf = await crearReportePdf({
    titulo: 'Vales sin usar',
    subtitulo: `${sucursal ?? 'Todas las sucursales'} · ${total} vale${total !== 1 ? 's' : ''} · ` +
               `${perdidos} perdido${perdidos !== 1 ? 's' : ''} · al ${formatFecha(hoyISO())}`,
    orientacion: 'landscape',
  })

  if (total === 0) {
    pdf.vacio('No hay vales sin usar. Todos los vales entregados ya se cargaron.')
    pdf.guardar(nombreBase(sucursal))
    return
  }

  // Con una sola sucursal el resumen sería un renglón que repite el subtítulo.
  if (grupos.length > 1) {
    pdf.seccion('Resumen por sucursal')
    pdf.tabla({
      head: ['Sucursal', 'Sin usar', 'Perdidos', 'Total'],
      body: [
        ...grupos.map((g) => [g.sucursal, g.sinUsar, g.perdidos, g.vales.length]),
        ['Total', total - perdidos, perdidos, total],
      ],
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' } },
      didParseCell: (d: CellHookData) => {
        if (d.section === 'body' && d.column.index === 2 && Number(d.cell.raw) > 0) {
          d.cell.styles.textColor = COLOR.rojo
        }
      },
      totalAlFinal: true,
      fontSize: 9,
    })
  }

  pdf.seccion(
    'Vales por sucursal',
    'Del más viejo al más nuevo. Un vale se da por perdido cuando lleva dos días o más sin usarse.',
  )
  for (const g of grupos) {
    pdf.subseccion(`${g.sucursal} · ${g.vales.length} vale${g.vales.length !== 1 ? 's' : ''}`)
    pdf.tabla({
      head: ['Folio', 'Entregado', 'Días', 'Estado', 'Chofer', 'Vehículo', 'Placas', 'Registró'],
      body: g.vales.map((v) => [
        v.folio, formatFecha(v.fecha), dias(v), ESTADO_VALE[v.estado].label,
        v.conductor, vehiculo(v), v.placas ?? '—', v.creado_por,
      ]),
      columnStyles: { 2: { halign: 'center' } },
      // En papel no hay badges: lo perdido se distingue en rojo.
      didParseCell: (d: CellHookData) => {
        if (d.section !== 'body' || (d.column.index !== 3 && d.column.index !== 2)) return
        if (g.vales[d.row.index]?.estado === 'perdido') {
          d.cell.styles.textColor = COLOR.rojo
          d.cell.styles.fontStyle = 'bold'
        }
      },
      fontSize: 9,
    })
  }

  pdf.guardar(nombreBase(sucursal))
}

export async function exportValesSinUsarExcel(vales: ValeGasolina[], sucursal: string | null) {
  const grupos = agruparPorSucursal(vales)
  const filas = grupos.flatMap((g) => g.vales)
  const wb = await crearLibroExcel()

  wb.hoja('Resumen', [
    { header: 'Sucursal', width: 24, valor: (g) => g.sucursal },
    { header: 'Sin usar', width: 12, formato: 'numero', valor: (g) => g.sinUsar },
    { header: 'Perdidos', width: 12, formato: 'numero', valor: (g) => g.perdidos },
    { header: 'Total',    width: 12, formato: 'numero', valor: (g) => g.vales.length },
  ], grupos, {
    totales: {
      Sucursal: 'Total',
      'Sin usar': grupos.reduce((s, g) => s + g.sinUsar, 0),
      Perdidos:   grupos.reduce((s, g) => s + g.perdidos, 0),
      Total:      filas.length,
    },
    vacio: 'No hay vales sin usar.',
  })

  wb.hoja('Vales', [
    { header: 'Sucursal',  width: 20, valor: (v) => sucursalDelVale(v) },
    { header: 'Folio',     width: 14, valor: (v) => v.folio },
    { header: 'Entregado', width: 13, formato: 'fecha', valor: (v) => new Date(`${v.fecha.split('T')[0]}T12:00:00`) },
    // Número para poder ordenar y filtrar.
    { header: 'Días sin usar', width: 14, formato: 'numero', valor: (v) => v.dias_sin_usar },
    { header: 'Estado',    width: 12, valor: (v) => ESTADO_VALE[v.estado].label },
    { header: 'Chofer',    width: 28, valor: (v) => v.conductor },
    { header: 'Vehículo',  width: 26, valor: (v) => vehiculo(v) },
    { header: 'Serie',     width: 20, valor: (v) => v.serie },
    { header: 'Placas',    width: 12, valor: (v) => v.placas ?? '—' },
    { header: 'Registró',  width: 30, valor: (v) => v.creado_por },
  ], filas, { vacio: 'No hay vales sin usar.' })

  await wb.guardar(nombreBase(sucursal))
}
