// Exporta el resumen de los últimos 30 días del dashboard a un libro de Excel (exceljs):
// hoja de resumen de costos, mantenimientos por vehículo y lotes comprados.
// exceljs se importa dinámicamente para no cargarlo en el bundle principal.
import type { ResumenMes } from '../hooks/useDashboard'

// `rango.end` es exclusivo: el último día cubierto es el anterior.
function ultimoDia(resumen: ResumenMes) {
  const fin = new Date(`${resumen.rango.end}T12:00:00`)
  fin.setDate(fin.getDate() - 1)
  return fin
}

function rangoLabel(resumen: ResumenMes) {
  const fmt = (d: Date) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
  const inicio = new Date(`${resumen.rango.start}T12:00:00`)
  return `${fmt(inicio)} – ${fmt(ultimoDia(resumen))}`
}

function fileNameBase(resumen: ResumenMes) {
  return `resumen-30-dias-${resumen.rango.start}`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function exportResumenMesToExcel(resumen: ResumenMes) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Refacciones Kora'
  wb.created = new Date()

  const wsResumen = wb.addWorksheet('Resumen')
  wsResumen.columns = [
    { header: 'Concepto', key: 'concepto', width: 46 },
    { header: 'Valor', key: 'valor', width: 22 },
  ]
  wsResumen.getRow(1).font = { bold: true }
  // El total no suma las piezas usadas en mantenimientos: ya vienen cobradas en
  // el costo de las refacciones compradas. Por eso se desglosan.
  wsResumen.addRows([
    { concepto: 'Periodo', valor: rangoLabel(resumen) },
    { concepto: 'Mantenimientos realizados', valor: resumen.mantenimientos.count },
    { concepto: 'Costo total mantenimientos', valor: resumen.mantenimientos.costo_total },
    { concepto: '    Mano de obra', valor: resumen.mantenimientos.costo_mano_obra },
    { concepto: '    Refacciones usadas (ya cobradas en la compra)', valor: resumen.mantenimientos.costo_piezas },
    { concepto: 'Refacciones compradas (lotes)', valor: resumen.piezas.count },
    { concepto: 'Costo total refacciones', valor: resumen.piezas.costo_total },
    { concepto: 'Costo total del periodo (mano de obra + refacciones compradas)', valor: resumen.costo_total_periodo },
  ])
  for (const rowNum of [4, 5, 6, 8, 9]) {
    wsResumen.getCell(rowNum, 2).numFmt = '"$"#,##0.00'
  }
  wsResumen.getRow(9).font = { bold: true }

  const wsMtto = wb.addWorksheet('Mantenimientos')
  wsMtto.columns = [
    { header: 'Vehículo',       key: 'vehiculo', width: 30 },
    { header: 'Mantenimientos', key: 'cantidad', width: 16 },
    { header: 'Costo total',    key: 'costo',    width: 18 },
  ]
  wsMtto.getRow(1).font = { bold: true }
  for (const v of resumen.mantenimientos.por_vehiculo) {
    wsMtto.addRow({ vehiculo: v.vehiculo_nombre, cantidad: v.cantidad, costo: v.costo_total })
  }
  wsMtto.getColumn('costo').numFmt = '"$"#,##0.00'
  wsMtto.addRow({ vehiculo: 'Total', cantidad: resumen.mantenimientos.count, costo: resumen.mantenimientos.costo_total })
    .font = { bold: true }

  const wsPiezas = wb.addWorksheet('Refacciones')
  wsPiezas.columns = [
    { header: 'Refacción',      key: 'pieza',       width: 24 },
    { header: 'Descripción',    key: 'descripcion', width: 30 },
    { header: 'Proveedor',      key: 'proveedor',   width: 22 },
    { header: 'Fecha',          key: 'fecha',       width: 14 },
    { header: 'Cantidad',       key: 'cantidad',    width: 12 },
    { header: 'Costo unitario', key: 'costoUnit',   width: 16 },
    { header: 'Subtotal',       key: 'subtotal',    width: 16 },
  ]
  wsPiezas.getRow(1).font = { bold: true }
  for (const l of resumen.piezas.lotes) {
    wsPiezas.addRow({
      pieza:       l.numero_serie,
      descripcion: l.descripcion,
      proveedor:   l.proveedor,
      fecha:       new Date(`${l.fecha_compra.split('T')[0]}T12:00:00`),
      cantidad:    l.cantidad_inicial,
      costoUnit:   l.costo_unitario,
      subtotal:    l.cantidad_inicial * l.costo_unitario,
    })
  }
  wsPiezas.getColumn('fecha').numFmt = 'dd/mm/yyyy'
  wsPiezas.getColumn('costoUnit').numFmt = '"$"#,##0.00'
  wsPiezas.getColumn('subtotal').numFmt = '"$"#,##0.00'
  wsPiezas.addRow({ pieza: 'Total', subtotal: resumen.piezas.costo_total }).font = { bold: true }

  const buffer = await wb.xlsx.writeBuffer()
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${fileNameBase(resumen)}.xlsx`
  )
}
