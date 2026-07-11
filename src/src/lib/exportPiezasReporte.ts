// Genera el PDF del reporte de inventario de piezas (jsPDF + autoTable),
// agrupado por categoría igual que la vista de la página Piezas, con las
// piezas sin existencias resaltadas en rojo. Las librerías se importan
// dinámicamente para no cargarlas en el bundle principal.
import type { CellHookData } from 'jspdf-autotable'
import type { Pieza } from '../hooks/useRefacciones'
import { CATEGORIAS } from './piezasCategorias'

function fileNameBase() {
  return `reporte-piezas-${new Date().toISOString().slice(0, 10)}`
}

function agruparPorCategoria(piezas: Pieza[]) {
  const conocidas = CATEGORIAS
    .map((categoria) => ({ categoria, items: piezas.filter((p) => p.categoria === categoria) }))
    .filter(({ items }) => items.length > 0)

  // Categorías creadas por el usuario (no están en la lista fija): cada una
  // forma su propio grupo, ordenadas alfabéticamente al final.
  const extraCategorias = Array.from(
    new Set(piezas.filter((p) => !CATEGORIAS.includes(p.categoria)).map((p) => p.categoria))
  ).sort((a, b) => a.localeCompare(b, 'es-MX'))
  const extras = extraCategorias.map((categoria) => ({ categoria, items: piezas.filter((p) => p.categoria === categoria) }))

  return [...conocidas, ...extras]
}

export async function exportPiezasReporteToPdf(piezas: Pieza[]) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const doc = new jsPDF()
  const margin = 14
  const pageHeight = doc.internal.pageSize.getHeight()
  let y = 16

  function ensureSpace(needed: number) {
    if (y + needed > pageHeight - 14) { doc.addPage(); y = 16 }
  }

  doc.setFontSize(16)
  doc.text('Reporte de inventario de piezas', margin, y)
  y += 7
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(
    `Generado el ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}`,
    margin, y
  )
  doc.setTextColor(0)
  y += 6

  const totalStock = piezas.reduce((sum, p) => sum + p.cantidad_total, 0)
  const sinStock = piezas.filter((p) => p.cantidad_total === 0).length
  doc.text(
    `${piezas.length} piezas · ${totalStock.toLocaleString('es-MX')} unidades en stock · ${sinStock} sin existencias`,
    margin, y
  )
  y += 10

  const grupos = agruparPorCategoria(piezas)

  for (const { categoria, items } of grupos) {
    ensureSpace(16)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text(`${categoria} (${items.length})`, margin, y)
    doc.setFont('helvetica', 'normal')
    y += 6

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Número de serie', 'Descripción', 'En stock']],
      body: [...items]
        .sort((a, b) => a.numero_serie.localeCompare(b.numero_serie, 'es-MX'))
        .map((p) => [p.numero_serie, p.descripcion, String(p.cantidad_total)]),
      headStyles: { fillColor: [51, 51, 51], fontSize: 9 },
      styles: { fontSize: 9 },
      columnStyles: { 2: { halign: 'center' } },
      didParseCell: (data: CellHookData) => {
        if (data.section !== 'body') return
        if (data.column.index === 2 && Number(data.cell.raw) === 0) {
          data.cell.styles.textColor = [200, 40, 40]
          data.cell.styles.fontStyle = 'bold'
        }
      },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
  }

  doc.save(`${fileNameBase()}.pdf`)
}
