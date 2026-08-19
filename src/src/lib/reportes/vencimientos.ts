// Reporte de la pestaña Vencimientos: seguros, permisos, licencias y tenencias
// que ya vencieron o están por vencer, más las unidades a las que les falta el
// documento por completo.
//
// Este es el reporte que se imprime y se camina: sirve para ir tramitando y
// palomeando. Por eso lo ya vencido va primero y marcado en rojo — en papel no
// hay badges de color de fondo que lo distingan.
import type { DocumentosPorVencer } from '../../hooks/useDashboard'
import { unificarDocumentos, agruparSinDocumento, estadoVencimiento } from '../documentosDashboard'
import { crearReportePdf, hoyISO, COLOR, type CellHookData } from './pdfDoc'
import { crearLibroExcel } from './excelDoc'
import { formatFecha } from '../formato'
import { TIPO_LABELS } from '../tipoVehiculo'

function nombreBase(): string {
  return `vencimientos-${hoyISO()}`
}

function faltantes(v: { tenencia: boolean; seguro: boolean }): string {
  return [v.tenencia && 'Tenencia', v.seguro && 'Seguro'].filter(Boolean).join(' y ')
}

export async function exportVencimientosPdf(doc: DocumentosPorVencer | undefined) {
  const documentos = unificarDocumentos(doc)
  const sinDoc     = agruparSinDocumento(doc)
  const vencidos   = documentos.filter((d) => d.dias_restantes < 0)

  const pdf = await crearReportePdf({
    titulo: 'Documentos por vencer',
    subtitulo: `${documentos.length} documento${documentos.length !== 1 ? 's' : ''} en la lista · ` +
               `${vencidos.length} ya vencido${vencidos.length !== 1 ? 's' : ''}`,
    orientacion: 'landscape',
  })

  pdf.seccion(
    'Seguros, permisos, licencias y tenencias',
    'Seguros, permisos y tenencias ya vencidos o que vencen dentro de 30 días; licencias de conductor ' +
    'con vigencia dentro de 2 meses. Ordenados de lo más urgente a lo menos.',
  )
  if (documentos.length === 0) {
    pdf.vacio('Ningún documento por vencer. Todo en regla.')
  } else {
    pdf.tabla({
      head: ['Tipo', 'Documento', 'Expiración', 'Estado', 'Vehículos'],
      body: documentos.map((d) => [
        d.tipo, d.etiqueta, formatFecha(d.fecha_expiracion),
        estadoVencimiento(d.dias_restantes).label,
        d.vehiculos != null ? String(d.vehiculos) : '—',
      ]),
      columnStyles: { 4: { halign: 'center' } },
      // En papel el estado es lo único que distingue "urge hoy" de "urge en un
      // mes": va en rojo lo vencido y en naranja lo que vence esta semana.
      didParseCell: (d: CellHookData) => {
        if (d.section !== 'body' || d.column.index !== 3) return
        const fila = documentos[d.row.index]
        if (!fila) return
        if (fila.dias_restantes < 0)      { d.cell.styles.textColor = COLOR.rojo; d.cell.styles.fontStyle = 'bold' }
        else if (fila.dias_restantes <= 7) d.cell.styles.textColor = COLOR.naranja
      },
      fontSize: 9,
    })
  }

  pdf.seccion(
    'Vehículos sin documentos',
    'Unidades sin tenencia o sin seguro capturado. No aparecen arriba porque no tienen fecha de ' +
    'vencimiento que vigilar. La tenencia solo aplica a unidades de reparto y utilitarios.',
  )
  if (sinDoc.length === 0) {
    pdf.vacio('Todas las unidades tienen tenencia y seguro.')
  } else {
    pdf.tabla({
      head: ['Vehículo', 'Placas', 'Tipo', 'Le falta'],
      body: sinDoc.map((v) => [
        v.vehiculo, v.placas ?? '—', TIPO_LABELS[v.tipo] ?? v.tipo, faltantes(v),
      ]),
      didParseCell: (d: CellHookData) => {
        if (d.section === 'body' && d.column.index === 3) d.cell.styles.textColor = COLOR.rojo
      },
      fontSize: 9,
    })
  }

  pdf.guardar(nombreBase())
}

export async function exportVencimientosExcel(doc: DocumentosPorVencer | undefined) {
  const documentos = unificarDocumentos(doc)
  const sinDoc     = agruparSinDocumento(doc)
  const wb = await crearLibroExcel()

  wb.hoja('Por vencer', [
    { header: 'Tipo',        width: 20, valor: (d) => d.tipo },
    { header: 'Documento',   width: 44, valor: (d) => d.etiqueta },
    { header: 'Expiración',  width: 14, formato: 'fecha',  valor: (d) => new Date(`${d.fecha_expiracion.split('T')[0]}T12:00:00`) },
    // Los días se dejan como número con signo para poder filtrar y ordenar:
    // negativo = ya venció.
    { header: 'Días restantes', width: 15, formato: 'numero', valor: (d) => d.dias_restantes },
    { header: 'Estado',      width: 26, valor: (d) => estadoVencimiento(d.dias_restantes).label },
    { header: 'Vehículos',   width: 11, formato: 'numero', valor: (d) => d.vehiculos ?? 0 },
  ], documentos, { vacio: 'Ningún documento por vencer. Todo en regla.' })

  wb.hoja('Sin documentos', [
    { header: 'Vehículo', width: 40, valor: (v) => v.vehiculo },
    { header: 'Placas',   width: 14, valor: (v) => v.placas ?? '—' },
    { header: 'Tipo',     width: 22, valor: (v) => TIPO_LABELS[v.tipo] ?? v.tipo },
    { header: 'Le falta', width: 22, valor: (v) => faltantes(v) },
  ], sinDoc, { vacio: 'Todas las unidades tienen tenencia y seguro.' })

  await wb.guardar(nombreBase())
}
