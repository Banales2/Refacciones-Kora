// Reporte de la pestaña Pendientes: requerimientos preventivos vencidos y por
// vencer, incidencias abiertas y la tendencia acumulada.
//
// Es la orden de trabajo del taller. Va agrupado por vehículo y no por
// requerimiento porque así se atiende: la unidad entra una vez y se le hace
// todo lo que trae pendiente.
import type { RequerimientoVencido, IncidenciaAbierta, HistorialDia } from '../../hooks/useDashboard'
import { crearReportePdf, hoyISO, COLOR, type CellHookData } from './pdfDoc'
import { crearLibroExcel } from './excelDoc'
import { formatFecha, formatFechaCorta } from '../formato'
import { SEVERIDAD_META } from '../incidenciaMeta'

export interface DatosPendientes {
  vencidos:    RequerimientoVencido[]
  porVencer:   RequerimientoVencido[]
  incidencias: IncidenciaAbierta[]
  historial:   HistorialDia[]
}

interface GrupoVehiculo {
  vehiculo_id:     number
  vehiculo_nombre: string
  requerimientos:  RequerimientoVencido[]
}

function agrupar(items: RequerimientoVencido[]): GrupoVehiculo[] {
  const map = new Map<number, GrupoVehiculo>()
  for (const item of items) {
    const entry = map.get(item.vehiculo_id) ?? {
      vehiculo_id: item.vehiculo_id, vehiculo_nombre: item.vehiculo_nombre, requerimientos: [],
    }
    entry.requerimientos.push(item)
    map.set(item.vehiculo_id, entry)
  }
  // La unidad con más pendientes primero: es la que hay que meter al taller ya.
  return [...map.values()].sort(
    (a, b) => b.requerimientos.length - a.requerimientos.length ||
              a.vehiculo_nombre.localeCompare(b.vehiculo_nombre, 'es-MX'))
}

function nombreBase(): string {
  return `pendientes-${hoyISO()}`
}

// Las filas de la orden de trabajo: una por requerimiento, con el vehículo
// repetido solo en el primero de cada grupo para que se lea como bloque.
function filasAgrupadas(grupos: GrupoVehiculo[]): string[][] {
  return grupos.flatMap((g) =>
    g.requerimientos.map((r, i) => [
      i === 0 ? g.vehiculo_nombre : '',
      i === 0 ? String(g.requerimientos.length) : '',
      r.nombre,
      r.categoria ?? '—',
    ])
  )
}

export async function exportPendientesPdf(d: DatosPendientes) {
  const gruposVencidos  = agrupar(d.vencidos)
  const gruposPorVencer = agrupar(d.porVencer)
  const graves = d.incidencias.filter((i) => i.severidad === 'grave')

  const pdf = await crearReportePdf({
    titulo: 'Pendientes de mantenimiento',
    subtitulo:
      `${d.vencidos.length} requerimiento${d.vencidos.length !== 1 ? 's' : ''} vencido${d.vencidos.length !== 1 ? 's' : ''} · ` +
      `${d.porVencer.length} por vencer · ` +
      `${d.incidencias.length} incidencia${d.incidencias.length !== 1 ? 's' : ''} sin atender`,
    orientacion: 'landscape',
  })

  pdf.seccion(
    'Requerimientos vencidos',
    'Preventivos cuyo intervalo de kilómetros o de meses ya se pasó. Agrupados por unidad: ' +
    'la de arriba es la que más trae acumulado.',
  )
  if (gruposVencidos.length === 0) {
    pdf.vacio('No hay requerimientos vencidos hoy.')
  } else {
    pdf.tabla({
      head: ['Vehículo', 'Total', 'Requerimiento', 'Categoría'],
      body: filasAgrupadas(gruposVencidos),
      columnStyles: { 0: { cellWidth: 70 }, 1: { halign: 'center', cellWidth: 16 } },
      didParseCell: (c: CellHookData) => {
        if (c.section === 'body' && c.column.index <= 1 && String(c.cell.raw) !== '') {
          c.cell.styles.fontStyle = 'bold'
          c.cell.styles.textColor = COLOR.rojo
        }
      },
      fontSize: 9,
    })
  }

  pdf.seccion(
    'Requerimientos por vencer',
    'Preventivos que están por alcanzar su intervalo. Atenderlos aquí es lo que evita la falla cara.',
  )
  if (gruposPorVencer.length === 0) {
    pdf.vacio('No hay requerimientos próximos a vencer.')
  } else {
    pdf.tabla({
      head: ['Vehículo', 'Total', 'Requerimiento', 'Categoría'],
      body: filasAgrupadas(gruposPorVencer),
      columnStyles: { 0: { cellWidth: 70 }, 1: { halign: 'center', cellWidth: 16 } },
      didParseCell: (c: CellHookData) => {
        if (c.section === 'body' && c.column.index <= 1 && String(c.cell.raw) !== '') {
          c.cell.styles.fontStyle = 'bold'
          c.cell.styles.textColor = COLOR.naranja
        }
      },
      fontSize: 9,
    })
  }

  pdf.seccion(
    'Incidencias sin atender',
    'Lo reportado que sigue abierto, de lo más grave a lo más leve. Se cierran solas al registrar ' +
    'el mantenimiento que las atiende.',
  )
  if (d.incidencias.length === 0) {
    pdf.vacio('No hay incidencias sin atender.')
  } else {
    if (graves.length > 0) {
      pdf.parrafo(`${graves.length} de ellas ${graves.length !== 1 ? 'están marcadas' : 'está marcada'} como graves.`)
    }
    pdf.tabla({
      head: ['Incidencia', 'Vehículo', 'Categoría', 'Severidad', 'Reportada'],
      body: d.incidencias.map((i) => [
        i.nombre, i.vehiculo_nombre, i.categoria ?? '—',
        SEVERIDAD_META[i.severidad].label, formatFecha(i.fecha),
      ]),
      didParseCell: (c: CellHookData) => {
        if (c.section !== 'body' || c.column.index !== 3) return
        if (String(c.cell.raw) === SEVERIDAD_META.grave.label) {
          c.cell.styles.textColor = COLOR.rojo
          c.cell.styles.fontStyle = 'bold'
        }
      },
      fontSize: 9,
    })
  }

  if (d.historial.length >= 2) {
    pdf.seccion(
      'Tendencia',
      'Snapshot diario de lo acumulado. Una línea que sube es mantenimiento que se está posponiendo, ' +
      'y el preventivo pospuesto se cobra después como correctivo.',
    )
    // Solo los últimos 30 puntos: la tabla completa de un año no cabe y lo que
    // interesa de la tendencia es hacia dónde va ahora.
    const recientes = d.historial.slice(-30)
    pdf.tabla({
      head: ['Fecha', 'Vencidos', 'Por vencer'],
      body: recientes.map((h) => [formatFechaCorta(h.fecha), String(h.vencidos), String(h.por_vencer)]),
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } },
      fontSize: 9,
    })
  }

  pdf.guardar(nombreBase())
}

export async function exportPendientesExcel(d: DatosPendientes) {
  const wb = await crearLibroExcel()

  // En Excel no se agrupa: se deja plano y con autofiltro, que es lo que
  // permite ordenar por vehículo o por categoría según lo que se busque.
  const columnasReq = [
    { header: 'Vehículo',      width: 40, valor: (r: RequerimientoVencido) => r.vehiculo_nombre },
    { header: 'Requerimiento', width: 40, valor: (r: RequerimientoVencido) => r.nombre },
    { header: 'Categoría',     width: 22, valor: (r: RequerimientoVencido) => r.categoria ?? '—' },
  ]

  wb.hoja('Vencidos',  columnasReq, d.vencidos,  { vacio: 'No hay requerimientos vencidos hoy.' })
  wb.hoja('Por vencer', columnasReq, d.porVencer, { vacio: 'No hay requerimientos próximos a vencer.' })

  wb.hoja('Incidencias', [
    { header: 'Incidencia', width: 40, valor: (i) => i.nombre },
    { header: 'Vehículo',   width: 40, valor: (i) => i.vehiculo_nombre },
    { header: 'Categoría',  width: 22, valor: (i) => i.categoria ?? '—' },
    { header: 'Severidad',  width: 14, valor: (i) => SEVERIDAD_META[i.severidad].label },
    { header: 'Reportada',  width: 14, formato: 'fecha', valor: (i) => new Date(`${i.fecha.split('T')[0]}T12:00:00`) },
  ], d.incidencias, { vacio: 'No hay incidencias sin atender.' })

  wb.hoja('Tendencia', [
    { header: 'Fecha',      width: 14, formato: 'fecha',  valor: (h) => new Date(`${h.fecha.split('T')[0]}T12:00:00`) },
    { header: 'Vencidos',   width: 12, formato: 'numero', valor: (h) => h.vencidos },
    { header: 'Por vencer', width: 12, formato: 'numero', valor: (h) => h.por_vencer },
  ], d.historial, { vacio: 'Aún no hay historial acumulado.' })

  await wb.guardar(nombreBase())
}
