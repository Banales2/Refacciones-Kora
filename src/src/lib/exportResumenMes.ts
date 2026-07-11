// Exporta el resumen del mes del dashboard a un libro de Excel (exceljs):
// hoja de resumen de costos, mantenimientos por vehículo y lotes comprados.
// exceljs se importa dinámicamente para no cargarlo en el bundle principal.
import type { ResumenMes } from '../hooks/useDashboard'

function rangoLabel(resumen: ResumenMes) {
  const inicio = new Date(`${resumen.rango.start}T12:00:00`)
  return inicio.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
}

function fileNameBase(resumen: ResumenMes) {
  return `resumen-mensual-${resumen.rango.start.slice(0, 7)}`
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

  const costoTotalMes = resumen.mantenimientos.costo_total + resumen.piezas.costo_total

  const wsResumen = wb.addWorksheet('Resumen')
  wsResumen.columns = [
    { header: 'Concepto', key: 'concepto', width: 32 },
    { header: 'Valor', key: 'valor', width: 22 },
  ]
  wsResumen.getRow(1).font = { bold: true }
  wsResumen.addRows([
    { concepto: 'Periodo', valor: rangoLabel(resumen) },
    { concepto: 'Mantenimientos realizados', valor: resumen.mantenimientos.count },
    { concepto: 'Costo total mantenimientos', valor: resumen.mantenimientos.costo_total },
    { concepto: 'Piezas compradas (lotes)', valor: resumen.piezas.count },
    { concepto: 'Costo total piezas', valor: resumen.piezas.costo_total },
    { concepto: 'Costo total del mes', valor: costoTotalMes },
  ])
  for (const rowNum of [3, 5, 6]) {
    wsResumen.getCell(rowNum, 2).numFmt = '"$"#,##0.00'
  }

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

  const wsPiezas = wb.addWorksheet('Piezas')
  wsPiezas.columns = [
    { header: 'Pieza',          key: 'pieza',       width: 24 },
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
