// Genera el PDF del reporte de flota del dashboard (jsPDF + autoTable):
// costos del mes, comparación vs periodo anterior y detalle por vehículo
// agrupado por ubicación. Las librerías se importan dinámicamente para no
// cargarlas en el bundle principal.
import type { CellHookData } from 'jspdf-autotable'
import type { ReporteFlota } from '../hooks/useDashboard'
import type { Sucursal } from '../hooks/useSucursales'
import { agruparVehiculosPorUbicacion } from './agruparVehiculosReporte'

function formatMXN(n: number) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function formatFecha(iso: string | null) {
  if (!iso) return '—'
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function rangoMesLabel(rango: { start: string; end: string }) {
  const inicio = new Date(`${rango.start}T12:00:00`)
  return inicio.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
}

function rangoCortoLabel(rango: { start: string; end: string }) {
  const inicio = new Date(`${rango.start}T12:00:00`)
  const finIncl = new Date(`${rango.end}T12:00:00`)
  finIncl.setDate(finIncl.getDate() - 1)
  const fmt = (d: Date) => d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
  return `${fmt(inicio)} – ${fmt(finIncl)}`
}

function deltaLabel(actual: number, anterior: number | null): string {
  if (anterior === null) return '(sin historial suficiente para comparar)'
  const delta = actual - anterior
  if (delta === 0) return '(sin cambio vs periodo anterior)'
  return `(${delta > 0 ? '+' : ''}${delta} vs periodo anterior)`
}

function fileNameBase(reporte: ReporteFlota) {
  return `reporte-flota-${reporte.rango_costos.start.slice(0, 7)}`
}

export async function exportReporteFlotaToPdf(reporte: ReporteFlota, sucursales: Sucursal[]) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const doc = new jsPDF({ orientation: 'landscape' })
  const margin = 14
  const pageHeight = doc.internal.pageSize.getHeight()
  let y = 16

  function ensureSpace(needed: number) {
    if (y + needed > pageHeight - 14) { doc.addPage(); y = 16 }
  }

  doc.setFontSize(16)
  doc.text('Reporte de flotilla', margin, y)
  y += 7
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`Costos de ${rangoMesLabel(reporte.rango_costos)}`, margin, y)
  doc.setTextColor(0)
  y += 10

  // ── Costos del mes ──
  doc.setFontSize(12)
  doc.text('Costos del mes', margin, y)
  y += 7
  doc.setFontSize(10)
  const costoLineas = [
    `Mano de obra (mantenimiento sin refacciones): ${formatMXN(reporte.costos.mano_obra)}`,
    `Refacciones usadas en mantenimientos:         ${formatMXN(reporte.costos.piezas_usadas)}`,
    `Subtotal mantenimiento:                       ${formatMXN(reporte.costos.total_mantenimiento)}`,
    `Refacciones compradas (lotes del mes):        ${formatMXN(reporte.costos.piezas_compradas)}`,
  ]
  for (const linea of costoLineas) { doc.text(linea, margin, y); y += 6 }
  doc.setFont('helvetica', 'bold')
  doc.text(`Costo total del mes: ${formatMXN(reporte.costos.total)}`, margin, y)
  doc.setFont('helvetica', 'normal')
  y += 10

  // ── Comparación vs periodo anterior ──
  const periodoLabel = reporte.periodo === 'semana' ? 'la semana' : 'el mes'
  doc.setFontSize(12)
  doc.text(`Comparación vs ${periodoLabel} anterior`, margin, y)
  y += 5
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(
    `${rangoCortoLabel(reporte.comparacion.rango_actual)}  vs  ${rangoCortoLabel(reporte.comparacion.rango_anterior)}`,
    margin, y
  )
  doc.setTextColor(0)
  y += 7
  doc.setFontSize(10)
  const compLineas = [
    `Requerimientos vencidos: ${reporte.comparacion.vencidos_actual} ` +
      deltaLabel(reporte.comparacion.vencidos_actual, reporte.comparacion.vencidos_anterior),
    `Requerimientos únicos nuevos: ${reporte.comparacion.requerimientos_unicos_nuevos_actual} ` +
      deltaLabel(reporte.comparacion.requerimientos_unicos_nuevos_actual, reporte.comparacion.requerimientos_unicos_nuevos_anterior),
  ]
  for (const linea of compLineas) { doc.text(linea, margin, y); y += 6 }
  y += 6

  // ── Detalle por vehículo, agrupado como en la pestaña Vehículos ──
  const grupos = agruparVehiculosPorUbicacion(reporte.vehiculos, sucursales)

  for (const grupo of grupos) {
    ensureSpace(16)
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text(grupo.label, margin, y)
    doc.setFont('helvetica', 'normal')
    y += 7

    for (const sub of grupo.tipos) {
      ensureSpace(14)
      doc.setFontSize(10.5)
      doc.setTextColor(80)
      doc.text(`${sub.label} (${sub.items.length})`, margin, y)
      doc.setTextColor(0)
      y += 2

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [[
          'Marca / Modelo', 'Serie', 'Placas', 'Estatus', 'Km',
          'Mtto. mes', 'Mano obra', 'Refacc.', 'Vencidos', 'Por vencer', 'Último mtto.',
        ]],
        body: sub.items.map(v => [
          `${v.marca} ${v.modelo}`,
          v.serie,
          v.placas ?? '—',
          v.status ?? '—',
          v.kilometraje != null ? `${v.kilometraje.toLocaleString('es-MX')} km` : '—',
          String(v.mantenimientos_mes),
          formatMXN(v.costo_mano_obra_mes),
          formatMXN(v.costo_piezas_mes),
          String(v.vencidos),
          String(v.por_vencer),
          formatFecha(v.ultimo_mantenimiento),
        ]),
        headStyles: { fillColor: [51, 51, 51], fontSize: 8 },
        styles: { fontSize: 8 },
        columnStyles: {
          4: { halign: 'right' },  5: { halign: 'center' }, 6: { halign: 'right' },
          7: { halign: 'right' },  8: { halign: 'center' }, 9: { halign: 'center' },
        },
        didParseCell: (data: CellHookData) => {
          if (data.section !== 'body') return
          if (data.column.index === 8 && Number(data.cell.raw) > 0) {
            data.cell.styles.textColor = [200, 40, 40]
            data.cell.styles.fontStyle = 'bold'
          }
          if (data.column.index === 9 && Number(data.cell.raw) > 0) {
            data.cell.styles.textColor = [190, 130, 20]
          }
        },
      })
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
    }
  }

  doc.save(`${fileNameBase(reporte)}.pdf`)
}
