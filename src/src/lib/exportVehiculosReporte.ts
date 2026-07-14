// Genera el PDF del reporte de inventario de vehículos (jsPDF + autoTable),
// agrupado por ubicación y tipo igual que la vista de la página Vehículos.
// Las librerías se importan dinámicamente para no cargarlas en el bundle
// principal.
import type { VehiculoRow, TipoVehiculo } from '../hooks/useVehiculos'
import type { Sucursal } from '../hooks/useSucursales'
import { TIPO_LABELS } from './tipoVehiculo'

const TIPO_ORDEN: TipoVehiculo[] = ['camion', 'tractocamion', 'caja_trailer', 'utilitario', 'montacargas']

function formatFecha(iso: string | null) {
  if (!iso) return '—'
  return new Date(`${iso.split('T')[0]}T12:00:00`).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function compareVehiculos(a: VehiculoRow, b: VehiculoRow): number {
  const porModelo = `${a.marca} ${a.modelo}`.localeCompare(`${b.marca} ${b.modelo}`, 'es-MX')
  if (porModelo !== 0) return porModelo
  return a.serie.localeCompare(b.serie, 'es-MX', { numeric: true })
}

interface GrupoTipo { tipo: TipoVehiculo; label: string; items: VehiculoRow[] }
interface GrupoUbicacion { label: string; tipos: GrupoTipo[] }

function agruparPorTipo(items: VehiculoRow[]): GrupoTipo[] {
  const map = new Map<TipoVehiculo, VehiculoRow[]>()
  for (const v of items) {
    if (!map.has(v.tipo)) map.set(v.tipo, [])
    map.get(v.tipo)!.push(v)
  }
  return TIPO_ORDEN
    .filter((t) => map.has(t))
    .map((t) => ({ tipo: t, label: TIPO_LABELS[t] ?? t, items: [...map.get(t)!].sort(compareVehiculos) }))
}

// Agrupa igual que la vista de la pestaña Vehículos: primero por ubicación
// (Rutas, cada sucursal, sin sucursal, y vehículos unitarios), y dentro de
// cada una por tipo de vehículo.
function agruparPorUbicacion(vehiculos: VehiculoRow[], sucursales: Sucursal[]): GrupoUbicacion[] {
  const rutas       = vehiculos.filter((v) => v.tipo === 'tractocamion' || v.tipo === 'caja_trailer')
  const conSucursal = vehiculos.filter((v) => v.tipo === 'camion' || v.tipo === 'montacargas')
  const unitarios   = vehiculos.filter((v) => v.tipo === 'utilitario')
  const porSucursal = sucursales.map((s) => ({ sucursal: s, items: conSucursal.filter((v) => v.sucursal_id === s.id) }))
  const sinSucursal = conSucursal.filter((v) => !sucursales.some((s) => s.id === v.sucursal_id))

  const grupos: GrupoUbicacion[] = []
  if (rutas.length)       grupos.push({ label: 'Rutas',               tipos: agruparPorTipo(rutas) })
  for (const { sucursal, items } of porSucursal) {
    if (items.length)     grupos.push({ label: sucursal.nombre,       tipos: agruparPorTipo(items) })
  }
  if (sinSucursal.length)  grupos.push({ label: 'Sin sucursal',       tipos: agruparPorTipo(sinSucursal) })
  if (unitarios.length)    grupos.push({ label: 'Vehículos utilitarios', tipos: agruparPorTipo(unitarios) })
  return grupos
}

function fileNameBase() {
  return `reporte-vehiculos-${new Date().toISOString().slice(0, 10)}`
}

export async function exportVehiculosReporteToPdf(vehiculos: VehiculoRow[], sucursales: Sucursal[]) {
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
  doc.text('Reporte de inventario de vehículos', margin, y)
  y += 7
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(
    `Generado el ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })} · ${vehiculos.length} vehículos`,
    margin, y
  )
  doc.setTextColor(0)
  y += 10

  const grupos = agruparPorUbicacion(vehiculos, sucursales)

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
        head: [['Marca / Modelo', 'Serie', 'Placas', 'Estatus', 'Km', 'Tenencia', 'Fecha de compra']],
        body: sub.items.map((v) => [
          `${v.marca} ${v.modelo}`,
          v.serie,
          v.placas ?? '—',
          v.status ?? '—',
          v.kilometraje != null ? `${v.kilometraje.toLocaleString('es-MX')} km` : '—',
          v.tenencia ?? '—',
          formatFecha(v.fecha_compra),
        ]),
        headStyles: { fillColor: [51, 51, 51], fontSize: 8 },
        styles: { fontSize: 8 },
        columnStyles: { 4: { halign: 'right' } },
      })
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
    }
  }

  doc.save(`${fileNameBase()}.pdf`)
}
