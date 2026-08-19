// Reporte de la pestaña Resumen: costos de los últimos 30 días, mantenimientos
// por vehículo y refacciones compradas. Es el corte que se lleva a la junta
// mensual, así que lleva los mismos números que la pantalla y en el mismo
// orden — si algo no cuadra, se tiene que poder señalar el renglón.
import type { ResumenMes } from '../../hooks/useDashboard'
import { crearReportePdf, hoyISO } from './pdfDoc'
import { crearLibroExcel } from './excelDoc'
import { formatMXN, formatFecha } from '../formato'

// `rango.end` es exclusivo: el último día cubierto es el anterior.
function rangoLabel(resumen: ResumenMes): string {
  const fin = new Date(`${resumen.rango.end}T12:00:00`)
  fin.setDate(fin.getDate() - 1)
  const fmt = (d: Date) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
  return `${fmt(new Date(`${resumen.rango.start}T12:00:00`))} – ${fmt(fin)}`
}

function nombreBase(resumen: ResumenMes): string {
  return `resumen-30-dias-${resumen.rango.start}`
}

// Desglose de costos. Se arma una sola vez porque el PDF y el Excel tienen que
// decir exactamente lo mismo: es el bloque que alguien va a comparar contra su
// propia hoja de cálculo.
function conceptos(resumen: ResumenMes): [string, string][] {
  return [
    ['Periodo', rangoLabel(resumen)],
    ['Mantenimientos realizados', String(resumen.mantenimientos.count)],
    ['    Mano de obra', formatMXN(resumen.mantenimientos.costo_mano_obra)],
    ['    Refacciones usadas (ya cobradas al comprarlas)', formatMXN(resumen.mantenimientos.costo_piezas)],
    ['    Subtotal mantenimientos', formatMXN(resumen.mantenimientos.costo_total)],
    ['Lotes de refacción comprados', String(resumen.piezas.count)],
    ['    Costo de refacciones compradas', formatMXN(resumen.piezas.costo_total)],
    ['Costo total del periodo (mano de obra + refacciones compradas)', formatMXN(resumen.costo_total_periodo)],
  ]
}

const NOTA_TOTAL =
  'El costo total no suma las refacciones consumidas por los mantenimientos: ya se pagaron ' +
  'al comprarlas, y contarlas otra vez duplicaría el gasto. Por eso el total es mano de obra ' +
  'más refacciones compradas.'

export async function exportResumenPdf(resumen: ResumenMes) {
  const pdf = await crearReportePdf({
    titulo: 'Resumen de costos de la flota',
    subtitulo: rangoLabel(resumen),
  })

  pdf.seccion('Costos del periodo')
  pdf.datos(conceptos(resumen).slice(1), { destacarUltimo: true })
  pdf.nota(NOTA_TOTAL)

  pdf.seccion('Mantenimientos por vehículo')
  const porVehiculo = resumen.mantenimientos.por_vehiculo
  if (porVehiculo.length === 0) {
    pdf.vacio('Sin mantenimientos registrados en el periodo.')
  } else {
    pdf.tabla({
      head: ['Vehículo', 'Mantenimientos', 'Costo total'],
      body: [
        ...porVehiculo.map((v) => [v.vehiculo_nombre, String(v.cantidad), formatMXN(v.costo_total)]),
        ['Total', String(resumen.mantenimientos.count), formatMXN(resumen.mantenimientos.costo_total)],
      ],
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } },
      totalAlFinal: true,
      fontSize: 9,
    })
  }

  pdf.seccion('Refacciones compradas')
  const lotes = resumen.piezas.lotes
  if (lotes.length === 0) {
    pdf.vacio('Sin compras registradas en el periodo.')
  } else {
    pdf.tabla({
      head: ['Refacción', 'Descripción', 'Proveedor', 'Fecha', 'Cant.', 'Costo unit.', 'Subtotal'],
      body: [
        ...lotes.map((l) => [
          l.numero_serie, l.descripcion, l.proveedor, formatFecha(l.fecha_compra),
          String(l.cantidad_inicial), formatMXN(l.costo_unitario),
          formatMXN(l.cantidad_inicial * l.costo_unitario),
        ]),
        ['Total', '', '', '', '', '', formatMXN(resumen.piezas.costo_total)],
      ],
      columnStyles: { 4: { halign: 'center' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      totalAlFinal: true,
    })
  }

  pdf.guardar(nombreBase(resumen))
}

export async function exportResumenExcel(resumen: ResumenMes) {
  const wb = await crearLibroExcel()

  // Los conceptos van con el número crudo, no con el texto formateado: en Excel
  // se espera poder sumarlos.
  wb.hojaResumen('Resumen', [
    ['Periodo', rangoLabel(resumen)],
    ['Mantenimientos realizados', resumen.mantenimientos.count],
    ['    Mano de obra', resumen.mantenimientos.costo_mano_obra],
    ['    Refacciones usadas (ya cobradas al comprarlas)', resumen.mantenimientos.costo_piezas],
    ['    Subtotal mantenimientos', resumen.mantenimientos.costo_total],
    ['Lotes de refacción comprados', resumen.piezas.count],
    ['    Costo de refacciones compradas', resumen.piezas.costo_total],
    ['Costo total del periodo (mano de obra + refacciones compradas)', resumen.costo_total_periodo],
    ['', ''],
    ['Nota', NOTA_TOTAL],
  ], { moneda: [2, 3, 4, 6, 7] })

  wb.hoja('Mantenimientos', [
    { header: 'Vehículo',       width: 34, valor: (v) => v.vehiculo_nombre },
    { header: 'Mantenimientos', width: 16, formato: 'numero', valor: (v) => v.cantidad },
    { header: 'Costo total',    width: 18, formato: 'moneda', valor: (v) => v.costo_total },
  ], resumen.mantenimientos.por_vehiculo, {
    totales: {
      'Vehículo': 'Total',
      'Mantenimientos': resumen.mantenimientos.count,
      'Costo total': resumen.mantenimientos.costo_total,
    },
    vacio: 'Sin mantenimientos registrados en el periodo.',
  })

  wb.hoja('Refacciones', [
    { header: 'Refacción',      width: 22, valor: (l) => l.numero_serie },
    { header: 'Descripción',    width: 34, valor: (l) => l.descripcion },
    { header: 'Proveedor',      width: 24, valor: (l) => l.proveedor },
    { header: 'Fecha',          width: 14, formato: 'fecha',  valor: (l) => new Date(`${l.fecha_compra.split('T')[0]}T12:00:00`) },
    { header: 'Cantidad',       width: 12, formato: 'numero', valor: (l) => l.cantidad_inicial },
    { header: 'Costo unitario', width: 16, formato: 'moneda', valor: (l) => l.costo_unitario },
    { header: 'Subtotal',       width: 16, formato: 'moneda', valor: (l) => l.cantidad_inicial * l.costo_unitario },
  ], resumen.piezas.lotes, {
    totales: { 'Refacción': 'Total', 'Subtotal': resumen.piezas.costo_total },
    vacio: 'Sin compras registradas en el periodo.',
  })

  await wb.guardar(`${nombreBase(resumen)}-${hoyISO()}`)
}
