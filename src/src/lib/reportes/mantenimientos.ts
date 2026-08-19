// Reporte del historial de mantenimientos de la flota.
//
// Sale con los filtros que estén puestos en la pantalla, no con el histórico
// completo: quien filtra por "Correctivo 2026" y luego exporta espera eso mismo
// en el archivo. Los filtros aplicados se imprimen en la portada para que el
// documento diga de qué es, y un total que no cuadre con otro reporte se pueda
// explicar sin adivinar.
import type { MantenimientoDeFlota } from '../../hooks/useMantenimientos'
import { crearReportePdf, hoyISO, COLOR, type CellHookData } from './pdfDoc'
import { crearLibroExcel } from './excelDoc'
import { formatMXN, formatNum, formatFecha } from '../formato'
import { TIPO_LABELS } from '../tipoVehiculo'

export interface FiltrosMantenimientos {
  busqueda?: string
  tipo?:     string | null
  anio?:     string | null
}

function descripcionFiltros(f: FiltrosMantenimientos): string {
  const partes: string[] = []
  if (f.tipo)                partes.push(`tipo ${f.tipo}`)
  if (f.anio)                partes.push(`año ${f.anio}`)
  if (f.busqueda?.trim())    partes.push(`búsqueda "${f.busqueda.trim()}"`)
  return partes.length ? `Filtrado por ${partes.join(', ')}` : 'Historial completo'
}

interface Totales {
  manoObra: number
  piezas:   number
  total:    number
}

function totalesDe(items: MantenimientoDeFlota[]): Totales {
  const manoObra = items.reduce((s, m) => s + (m.costo ?? 0), 0)
  const piezas   = items.reduce((s, m) => s + (m.piezas_total ?? 0), 0)
  return { manoObra, piezas, total: manoObra + piezas }
}

// Agrupación por unidad: es la pregunta que sigue después de "cuánto gastamos"
// —"¿en cuál?"— y sale gratis del mismo listado.
interface PorUnidad {
  serie:    string
  placas:   string | null
  tipo:     string
  servicios: number
  manoObra: number
  piezas:   number
  total:    number
  ultimo:   string | null
}

function agruparPorUnidad(items: MantenimientoDeFlota[]): PorUnidad[] {
  const map = new Map<number, PorUnidad>()
  for (const m of items) {
    const e = map.get(m.vehiculo_id) ?? {
      serie: m.vehiculo_serie, placas: m.vehiculo_placas, tipo: m.vehiculo_tipo,
      servicios: 0, manoObra: 0, piezas: 0, total: 0, ultimo: null,
    }
    e.servicios += 1
    e.manoObra  += m.costo ?? 0
    e.piezas    += m.piezas_total ?? 0
    e.total      = e.manoObra + e.piezas
    if (m.fecha && (!e.ultimo || m.fecha > e.ultimo)) e.ultimo = m.fecha
    map.set(m.vehiculo_id, e)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

// Cuánto pesa cada tipo de servicio. Un correctivo que se come al preventivo es
// el síntoma de que el mantenimiento se está haciendo tarde y caro.
interface PorTipo { tipo: string; servicios: number; total: number; pct: number }

function agruparPorTipo(items: MantenimientoDeFlota[], granTotal: number): PorTipo[] {
  const map = new Map<string, PorTipo>()
  for (const m of items) {
    const clave = m.tipo ?? 'Sin tipo'
    const e = map.get(clave) ?? { tipo: clave, servicios: 0, total: 0, pct: 0 }
    e.servicios += 1
    e.total     += (m.costo ?? 0) + (m.piezas_total ?? 0)
    map.set(clave, e)
  }
  const lista = [...map.values()]
  for (const e of lista) e.pct = granTotal > 0 ? (e.total / granTotal) * 100 : 0
  return lista.sort((a, b) => b.total - a.total)
}

function ordenarPorFecha(items: MantenimientoDeFlota[]): MantenimientoDeFlota[] {
  return [...items].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '') || b.id - a.id)
}

function nombreBase(f: FiltrosMantenimientos): string {
  const sufijo = [f.tipo?.toLowerCase(), f.anio].filter(Boolean).join('-')
  return `mantenimientos${sufijo ? `-${sufijo}` : ''}-${hoyISO()}`
}

export async function exportMantenimientosPdf(
  items: MantenimientoDeFlota[], filtros: FiltrosMantenimientos = {},
) {
  const t = totalesDe(items)
  const pdf = await crearReportePdf({
    titulo: 'Historial de mantenimientos',
    subtitulo: `${descripcionFiltros(filtros)} · ${items.length} servicio${items.length !== 1 ? 's' : ''}`,
    orientacion: 'landscape',
  })

  pdf.seccion('Totales de lo reportado')
  pdf.datos([
    ['Servicios registrados', String(items.length)],
    ['Mano de obra', formatMXN(t.manoObra)],
    ['Refacciones consumidas', formatMXN(t.piezas)],
    ['Costo total', formatMXN(t.total)],
  ], { destacarUltimo: true })
  pdf.nota(
    'Las refacciones son las que consumieron estos servicios, valuadas al costo del lote del que ' +
    'salieron. No es salida de caja del periodo: se pagaron al comprar el lote.'
  )

  if (items.length === 0) {
    pdf.seccion('Detalle')
    pdf.vacio('Ningún mantenimiento coincide con los filtros.')
    pdf.guardar(nombreBase(filtros))
    return
  }

  pdf.seccion('Por tipo de servicio')
  pdf.tabla({
    head: ['Tipo', 'Servicios', 'Costo', '% del total'],
    body: agruparPorTipo(items, t.total).map((e) => [
      e.tipo, String(e.servicios), formatMXN(e.total), `${e.pct.toFixed(1)}%`,
    ]),
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    didParseCell: (d: CellHookData) => {
      if (d.section === 'body' && d.column.index === 0 && String(d.cell.raw) === 'Correctivo') {
        d.cell.styles.textColor = COLOR.naranja
      }
    },
    fontSize: 9,
  })

  pdf.seccion(
    'Por unidad',
    'De la que más ha costado a la que menos, dentro de lo filtrado.',
  )
  const porUnidad = agruparPorUnidad(items)
  pdf.tabla({
    head: ['Serie', 'Placas', 'Tipo de unidad', 'Servicios', 'Mano de obra', 'Refacciones', 'Total', 'Último'],
    body: [
      ...porUnidad.map((u) => [
        u.serie, u.placas ?? '—', TIPO_LABELS[u.tipo] ?? u.tipo, String(u.servicios),
        formatMXN(u.manoObra), formatMXN(u.piezas), formatMXN(u.total),
        u.ultimo ? formatFecha(u.ultimo) : '—',
      ]),
      ['Total', '', '', String(items.length), formatMXN(t.manoObra), formatMXN(t.piezas), formatMXN(t.total), ''],
    ],
    columnStyles: {
      3: { halign: 'center' }, 4: { halign: 'right' },
      5: { halign: 'right' },  6: { halign: 'right' },
    },
    totalAlFinal: true,
    fontSize: 8,
  })

  pdf.seccion('Detalle de servicios', 'Del más reciente al más antiguo.')
  pdf.tabla({
    head: ['Fecha', 'Unidad', 'Placas', 'Tipo', 'Técnico', 'Km', 'Mano de obra', 'Refacciones', 'Total', 'Observaciones'],
    body: ordenarPorFecha(items).map((m) => [
      m.fecha ? formatFecha(m.fecha) : '—',
      m.vehiculo_serie,
      m.vehiculo_placas ?? '—',
      m.tipo ?? '—',
      m.tecnico ?? '—',
      m.km_actual ? formatNum(m.km_actual) : '—',
      formatMXN(m.costo ?? 0),
      formatMXN(m.piezas_total ?? 0),
      formatMXN((m.costo ?? 0) + (m.piezas_total ?? 0)),
      m.observaciones ?? '',
    ]),
    columnStyles: {
      5: { halign: 'right' }, 6: { halign: 'right' },
      7: { halign: 'right' }, 8: { halign: 'right' },
    },
    fontSize: 7.5,
  })

  pdf.guardar(nombreBase(filtros))
}

export async function exportMantenimientosExcel(
  items: MantenimientoDeFlota[], filtros: FiltrosMantenimientos = {},
) {
  const t = totalesDe(items)
  const wb = await crearLibroExcel()

  wb.hojaResumen('Resumen', [
    ['Alcance', descripcionFiltros(filtros)],
    ['Servicios registrados', items.length],
    ['Mano de obra', t.manoObra],
    ['Refacciones consumidas', t.piezas],
    ['Costo total', t.total],
    ['', ''],
    ['Nota', 'Las refacciones son las que consumieron estos servicios, valuadas al costo del lote ' +
             'del que salieron. No es salida de caja del periodo: se pagaron al comprar el lote.'],
  ], { moneda: [2, 3, 4] })

  wb.hoja('Servicios', [
    { header: 'Fecha',         width: 13, formato: 'fecha',
      valor: (m) => m.fecha ? new Date(`${m.fecha.split('T')[0]}T12:00:00`) : null },
    { header: 'Unidad',        width: 26, valor: (m) => m.vehiculo_serie },
    { header: 'Placas',        width: 14, valor: (m) => m.vehiculo_placas ?? '—' },
    { header: 'Tipo de unidad',width: 20, valor: (m) => TIPO_LABELS[m.vehiculo_tipo] ?? m.vehiculo_tipo },
    { header: 'Tipo',          width: 14, valor: (m) => m.tipo ?? '—' },
    { header: 'Técnico',       width: 24, valor: (m) => m.tecnico ?? '—' },
    { header: 'Kilometraje',   width: 13, formato: 'numero', valor: (m) => m.km_actual },
    { header: 'Mano de obra',  width: 15, formato: 'moneda', valor: (m) => m.costo ?? 0 },
    { header: 'Refacciones',   width: 15, formato: 'moneda', valor: (m) => m.piezas_total ?? 0 },
    { header: 'Total',         width: 15, formato: 'moneda', valor: (m) => (m.costo ?? 0) + (m.piezas_total ?? 0) },
    { header: 'Observaciones', width: 50, valor: (m) => m.observaciones ?? '' },
  ], ordenarPorFecha(items), {
    totales: {
      'Fecha': 'Total', 'Mano de obra': t.manoObra,
      'Refacciones': t.piezas, 'Total': t.total,
    },
    vacio: 'Ningún mantenimiento coincide con los filtros.',
  })

  wb.hoja('Por unidad', [
    { header: 'Serie',          width: 26, valor: (u) => u.serie },
    { header: 'Placas',         width: 14, valor: (u) => u.placas ?? '—' },
    { header: 'Tipo de unidad', width: 20, valor: (u) => TIPO_LABELS[u.tipo] ?? u.tipo },
    { header: 'Servicios',      width: 11, formato: 'numero', valor: (u) => u.servicios },
    { header: 'Mano de obra',   width: 15, formato: 'moneda', valor: (u) => u.manoObra },
    { header: 'Refacciones',    width: 15, formato: 'moneda', valor: (u) => u.piezas },
    { header: 'Total',          width: 15, formato: 'moneda', valor: (u) => u.total },
    { header: 'Último servicio',width: 15, formato: 'fecha',
      valor: (u) => u.ultimo ? new Date(`${u.ultimo.split('T')[0]}T12:00:00`) : null },
  ], agruparPorUnidad(items), {
    totales: {
      'Serie': 'Total', 'Servicios': items.length,
      'Mano de obra': t.manoObra, 'Refacciones': t.piezas, 'Total': t.total,
    },
    vacio: 'Ningún mantenimiento coincide con los filtros.',
  })

  wb.hoja('Por tipo', [
    { header: 'Tipo',        width: 20, valor: (e) => e.tipo },
    { header: 'Servicios',   width: 11, formato: 'numero', valor: (e) => e.servicios },
    { header: 'Costo',       width: 15, formato: 'moneda', valor: (e) => e.total },
    { header: '% del total', width: 13, formato: 'porcentaje', valor: (e) => e.pct },
  ], agruparPorTipo(items, t.total), { vacio: 'Ningún mantenimiento coincide con los filtros.' })

  await wb.guardar(nombreBase(filtros))
}
