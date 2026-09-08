// Lo que se le ha comprado a un proveedor, en PDF y en Excel.
//
// Es el documento con el que se sienta uno a negociar o a cuadrar contra sus
// facturas: cuánto se le lleva al año, en qué refacciones y a qué precio. Sale
// de los lotes de compra y no de la lista de precios —un precio cotizado nunca
// salió de la caja—, así que el total de aquí sí es dinero que se pagó.
//
// El desglose va por año porque es como se revisa: el cierre del ejercicio
// primero, y dentro de él las compras en orden.
import type { GastoProveedor } from '../../hooks/useProveedores'
import type { Proveedor } from '../../hooks/useProveedores'
import { crearReportePdf, hoyISO } from './pdfDoc'
import { crearLibroExcel } from './excelDoc'
import { formatMXN, formatFecha } from '../formato'
import { type Periodo, etiquetaPeriodo, sufijoPeriodo } from './periodo'

export interface DatosGastosProveedor {
  proveedor: Proveedor
  /** Ya filtrados por la pantalla: el reporte exporta lo que se está viendo. */
  gastos:    GastoProveedor[]
  periodo:   Periodo
  /** Texto de búsqueda aplicado, si lo hubo. Se anota para que el corte se pueda repetir. */
  busqueda?: string
}

function nombreBase(d: DatosGastosProveedor): string {
  const sufijo = sufijoPeriodo(d.periodo)
  const nombre = d.proveedor.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `gastos-${nombre}${sufijo ? `-${sufijo}` : ''}-${hoyISO()}`
}

type AnioDeGastos = { anio: string; total: number; compras: GastoProveedor[] }

// Los gastos llegan del más reciente al más viejo, así que los años salen en
// ese orden y las compras de cada uno conservan el suyo.
function agruparPorAnio(gastos: GastoProveedor[]): AnioDeGastos[] {
  const map = new Map<string, AnioDeGastos>()
  for (const g of gastos) {
    const anio = g.fecha_compra.slice(0, 4)
    const entry = map.get(anio) ?? { anio, total: 0, compras: [] }
    entry.total += g.total
    entry.compras.push(g)
    map.set(anio, entry)
  }
  return [...map.values()]
}

/** Cuánto se le ha comprado de cada refacción: dónde se concentra el gasto. */
type PorPieza = { pieza: string; serie: string; cantidad: number; total: number }

function agruparPorPieza(gastos: GastoProveedor[]): PorPieza[] {
  const map = new Map<number, PorPieza>()
  for (const g of gastos) {
    const entry = map.get(g.pieza_id)
      ?? { pieza: g.pieza, serie: g.pieza_serie, cantidad: 0, total: 0 }
    entry.cantidad += g.cantidad
    entry.total    += g.total
    map.set(g.pieza_id, entry)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

function subtitulo(d: DatosGastosProveedor): string {
  const partes = [etiquetaPeriodo(d.periodo, 'Historial completo')]
  if (d.busqueda?.trim()) partes.push(`Filtro: "${d.busqueda.trim()}"`)
  return partes.join(' · ')
}

export async function exportGastosProveedorPdf(d: DatosGastosProveedor) {
  const total  = d.gastos.reduce((s, g) => s + g.total, 0)
  const anios  = agruparPorAnio(d.gastos)
  const piezas = agruparPorPieza(d.gastos)

  const pdf = await crearReportePdf({
    titulo: `Gastos — ${d.proveedor.nombre}`,
    subtitulo: subtitulo(d),
    orientacion: 'landscape',
  })

  if (d.gastos.length === 0) {
    pdf.seccion('Sin compras en este periodo')
    pdf.vacio('No hay lotes registrados a nombre de este proveedor dentro del corte elegido.')
    pdf.guardar(nombreBase(d))
    return
  }

  pdf.seccion('Resumen')
  pdf.datos([
    ['Contacto',            d.proveedor.contacto ?? '—'],
    ['Teléfono',            d.proveedor.telefono ?? '—'],
    ['Compras registradas', String(d.gastos.length)],
    ['Refacciones distintas', String(piezas.length)],
    ['Primera compra del corte', formatFecha(d.gastos[d.gastos.length - 1].fecha_compra)],
    ['Última compra del corte',  formatFecha(d.gastos[0].fecha_compra)],
    ['Total comprado',      formatMXN(total)],
  ], { destacarUltimo: true })
  pdf.nota(
    'Sale de los lotes de compra: es lo que efectivamente se pagó. Los precios que el proveedor ' +
    'cotiza sin que se le compre no entran aquí.'
  )

  // ── Dónde se concentra el gasto ──
  pdf.seccion(
    'Por refacción',
    'De mayor a menor gasto. Es donde conviene pedir descuento o buscar otra cotización.',
  )
  pdf.tabla({
    head: ['Refacción', 'Serie', 'Cantidad', 'Total'],
    body: piezas.map((p) => [p.pieza, p.serie, String(p.cantidad), formatMXN(p.total)]),
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
    fontSize: 9,
  })

  // ── El detalle, año por año ──
  for (const a of anios) {
    pdf.seccion(
      `Compras de ${a.anio}`,
      `${a.compras.length} compra${a.compras.length !== 1 ? 's' : ''} · ${formatMXN(a.total)}`,
    )
    pdf.tabla({
      head: ['Fecha', 'Refacción', 'Serie', 'Cant.', 'Unitario', 'Total', 'Factura', 'Sucursal'],
      body: a.compras.map((c) => [
        formatFecha(c.fecha_compra), c.pieza, c.pieza_serie, String(c.cantidad),
        formatMXN(c.costo_unitario), formatMXN(c.total),
        c.num_factura ?? '—', c.sucursal ?? '—',
      ]),
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      fontSize: 8,
    })
  }

  pdf.guardar(nombreBase(d))
}

export async function exportGastosProveedorExcel(d: DatosGastosProveedor) {
  const wb = await crearLibroExcel()
  const total  = d.gastos.reduce((s, g) => s + g.total, 0)
  const piezas = agruparPorPieza(d.gastos)

  wb.hojaResumen('Resumen', [
    ['Proveedor',              d.proveedor.nombre],
    ['Contacto',               d.proveedor.contacto ?? '—'],
    ['Teléfono',               d.proveedor.telefono ?? '—'],
    ['Periodo',                etiquetaPeriodo(d.periodo, 'Historial completo')],
    ['Filtro de texto',        d.busqueda?.trim() || '—'],
    ['Compras registradas',    d.gastos.length],
    ['Refacciones distintas',  piezas.length],
    ['Total comprado',         total],
  ], { moneda: [7] })

  // Plano y con autofiltro: así se ordena por lo que cada quien busque.
  wb.hoja<GastoProveedor>('Compras', [
    { header: 'Fecha',     width: 13, formato: 'fecha',  valor: (g) => new Date(`${g.fecha_compra}T12:00:00`) },
    { header: 'Refacción', width: 40, valor: (g) => g.pieza },
    { header: 'Serie',     width: 20, valor: (g) => g.pieza_serie },
    { header: 'Tipo',      width: 20, valor: (g) => g.tipo_pieza ?? '—' },
    { header: 'Cantidad',  width: 11, formato: 'numero', valor: (g) => g.cantidad },
    { header: 'Unitario',  width: 14, formato: 'moneda', valor: (g) => g.costo_unitario },
    { header: 'Total',     width: 14, formato: 'moneda', valor: (g) => g.total },
    { header: 'Factura',   width: 18, valor: (g) => g.num_factura ?? '—' },
    { header: 'Sucursal',  width: 20, valor: (g) => g.sucursal ?? '—' },
    { header: 'Comprado por', width: 22, valor: (g) => g.comprado_por },
  ], d.gastos, {
    totales: { 'Total': total },
    vacio: 'No hay compras de este proveedor en el periodo elegido.',
  })

  wb.hoja<PorPieza>('Por refacción', [
    { header: 'Refacción', width: 40, valor: (p) => p.pieza },
    { header: 'Serie',     width: 20, valor: (p) => p.serie },
    { header: 'Cantidad',  width: 12, formato: 'numero', valor: (p) => p.cantidad },
    { header: 'Total',     width: 14, formato: 'moneda', valor: (p) => p.total },
  ], piezas, {
    totales: { 'Total': total },
    vacio: 'Sin compras en el periodo elegido.',
  })

  await wb.guardar(`${nombreBase(d)}.xlsx`)
}
