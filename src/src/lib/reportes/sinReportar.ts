// Reporte de lo que no se reportó: las recargas que salieron al cuadrar la
// factura de la gasolinera porque nadie las había capturado. Ver la migración
// 069.
//
// Son dos listas para dos personas distintas:
//
//   por chofer     las recargas que no avisó, y los tickets de otro tanque que
//                  no entregó de una recarga que sí avisó (077). Todo es suyo.
//   por encargado  los vales que no registró. Solo las recargas cuyo vale
//                  tampoco estaba; si el vale sí estaba, el encargado cumplió.
//
// Dentro de cada grupo, de la más vieja a la más nueva: es el orden en que se
// pregunta.
import type { SinReportar } from '../../hooks/useFacturasGasolina'
import { crearReportePdf, hoyISO } from './pdfDoc'
import { crearLibroExcel } from './excelDoc'
import { formatFecha, formatLitros, formatMXN } from '../formato'

export interface GrupoOmision {
  clave:    string
  nombre:   string
  detalle:  string | null
  items:    SinReportar[]
  litros:   number
  costo:    number
}

function agrupar(items: SinReportar[], clave: (r: SinReportar) => string,
  nombre: (r: SinReportar) => string, detalle: (r: SinReportar) => string | null): GrupoOmision[] {
  const grupos = new Map<string, GrupoOmision>()
  for (const r of items) {
    const k = clave(r)
    let g = grupos.get(k)
    if (!g) {
      g = { clave: k, nombre: nombre(r), detalle: detalle(r), items: [], litros: 0, costo: 0 }
      grupos.set(k, g)
    }
    g.items.push(r)
    g.litros += r.litros
    g.costo += r.costo
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.recarga_id - b.recarga_id) }))
    // Primero a quien más se le junta: es con quien hay que hablar primero.
    .sort((a, b) => b.items.length - a.items.length || a.nombre.localeCompare(b.nombre))
}

export function porChofer(items: SinReportar[]): GrupoOmision[] {
  return agrupar(items, (r) => String(r.conductor_id), (r) => r.conductor, () => null)
}

export function nombreEncargado(r: SinReportar): string {
  return r.encargado_nombre ?? r.encargado ?? 'Sin encargado'
}

export function porEncargado(items: SinReportar[]): GrupoOmision[] {
  return agrupar(
    items.filter((r) => r.vale_sin_registrar),
    (r) => (r.encargado ?? '').toLowerCase(),
    nombreEncargado,
    (r) => (r.encargado_nombre && r.encargado ? r.encargado : null),
  )
}

/** La recarga entera, o solo el ticket de otro tanque (migración 077). */
function faltante(r: SinReportar): string {
  return r.ticket_id === null ? 'Recarga' : 'Un ticket'
}

function periodo(desde?: string, hasta?: string): string {
  if (desde && hasta) return `del ${formatFecha(desde)} al ${formatFecha(hasta)}`
  if (desde) return `desde el ${formatFecha(desde)}`
  if (hasta) return `hasta el ${formatFecha(hasta)}`
  return 'todo el historial'
}

function nombreBase(): string {
  return `recargas-sin-reportar-${hoyISO()}`
}

export async function exportSinReportarPdf(items: SinReportar[], desde?: string, hasta?: string) {
  const choferes = porChofer(items)
  const encargados = porEncargado(items)
  const vales = encargados.reduce((s, g) => s + g.items.length, 0)

  const pdf = await crearReportePdf({
    titulo: 'Recargas sin reportar',
    subtitulo: `${periodo(desde, hasta)} · ${items.length} recarga${items.length !== 1 ? 's' : ''} · ` +
               `${vales} vale${vales !== 1 ? 's' : ''} sin registrar · al ${formatFecha(hoyISO())}`,
    orientacion: 'landscape',
  })

  if (items.length === 0) {
    pdf.vacio('No hay recargas sin reportar en el periodo.')
    pdf.guardar(nombreBase())
    return
  }

  pdf.seccion('Por chofer', 'Recargas que el chofer no reportó y aparecieron en la factura de la gasolinera.')
  for (const g of choferes) {
    pdf.subseccion(`${g.nombre} · ${g.items.length} recarga${g.items.length !== 1 ? 's' : ''} · ` +
      `${formatLitros(g.litros)} L · ${formatMXN(g.costo)}`)
    pdf.tabla({
      head: ['Fecha', 'Faltó', 'Vehículo', 'Placas', 'Gasolinera', 'Litros', 'Costo', 'Vale', 'Factura'],
      body: g.items.map((r) => [
        formatFecha(r.fecha), faltante(r), r.vehiculo, r.placas ?? '—', r.gasolinera ?? '—',
        formatLitros(r.litros), formatMXN(r.costo),
        r.vale_folio ? `${r.vale_folio}${r.vale_sin_registrar ? ' (sin registrar)' : ''}` : '—',
        r.factura_folio,
      ]),
      columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' } },
      fontSize: 9,
    })
  }

  if (encargados.length > 0) {
    pdf.seccion('Por encargado', 'Vales que se entregaron y no se registraron: el vale apareció con el ticket.')
    for (const g of encargados) {
      pdf.subseccion(`${g.nombre}${g.detalle ? ` (${g.detalle})` : ''} · ` +
        `${g.items.length} vale${g.items.length !== 1 ? 's' : ''}`)
      pdf.tabla({
        head: ['Folio', 'Entregado', 'Sucursal', 'Chofer', 'Vehículo', 'Cargado', 'Factura'],
        body: g.items.map((r) => [
          r.vale_folio ?? '—', r.vale_fecha ? formatFecha(r.vale_fecha) : '—', r.sucursal ?? '—',
          r.conductor, r.vehiculo, formatFecha(r.fecha), r.factura_folio,
        ]),
        fontSize: 9,
      })
    }
  }

  pdf.guardar(nombreBase())
}

export async function exportSinReportarExcel(items: SinReportar[]) {
  const wb = await crearLibroExcel()
  const fecha = (iso: string) => new Date(`${iso.split('T')[0]}T12:00:00`)
  const ordenadas = [...items].sort((a, b) => a.fecha.localeCompare(b.fecha))

  wb.hoja('Recargas', [
    { header: 'Fecha',      width: 13, formato: 'fecha', valor: (r) => fecha(r.fecha) },
    { header: 'Faltó',      width: 12, valor: (r) => faltante(r) },
    { header: 'Chofer',     width: 28, valor: (r) => r.conductor },
    { header: 'Vehículo',   width: 30, valor: (r) => r.vehiculo },
    { header: 'Placas',     width: 12, valor: (r) => r.placas ?? '—' },
    { header: 'Gasolinera', width: 22, valor: (r) => r.gasolinera ?? '—' },
    { header: 'Producto',   width: 12, valor: (r) => r.producto ?? '—' },
    { header: 'Litros',     width: 12, formato: 'litros', valor: (r) => r.litros },
    { header: 'Costo',      width: 14, formato: 'moneda', valor: (r) => r.costo },
    { header: 'Vale',       width: 14, valor: (r) => r.vale_folio ?? '—' },
    { header: 'Vale sin registrar', width: 18, valor: (r) => (r.vale_sin_registrar ? 'Sí' : 'No') },
    { header: 'Encargado',  width: 30, valor: (r) => nombreEncargado(r) },
    { header: 'Sucursal',   width: 20, valor: (r) => r.sucursal ?? '—' },
    { header: 'Factura',    width: 16, valor: (r) => r.factura_folio },
    { header: 'Registró',   width: 30, valor: (r) => r.capturado_por ?? '—' },
  ], ordenadas, { vacio: 'No hay recargas sin reportar.' })

  wb.hoja('Por chofer', [
    { header: 'Chofer',   width: 28, valor: (g) => g.nombre },
    { header: 'Recargas', width: 12, formato: 'numero', valor: (g) => g.items.length },
    { header: 'Litros',   width: 12, formato: 'litros', valor: (g) => g.litros },
    { header: 'Costo',    width: 14, formato: 'moneda', valor: (g) => g.costo },
  ], porChofer(items), { vacio: 'No hay recargas sin reportar.' })

  wb.hoja('Por encargado', [
    { header: 'Encargado', width: 30, valor: (g) => g.nombre },
    { header: 'Correo',    width: 30, valor: (g) => g.detalle ?? '' },
    { header: 'Vales sin registrar', width: 18, formato: 'numero', valor: (g) => g.items.length },
  ], porEncargado(items), { vacio: 'Todos los vales estaban registrados.' })

  await wb.guardar(nombreBase())
}
