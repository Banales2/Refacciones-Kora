// Lo que se ha cargado en una gasolinera, en PDF y en Excel.
//
// Sirve para dos cosas: cuadrar contra el estado de cuenta de la estación y
// decidir dónde conviene cargar. Por eso el número que manda no es el total
// sino el **precio promedio por litro**, que es lo comparable entre estaciones
// —una puede llevarse más dinero solo porque ahí carga la flota pesada—.
//
// El gasto sale de las recargas. El vale de gasolina no guarda costo ni
// gasolinera: es el papel que autoriza la carga, y aquí aparece como el folio
// de cada renglón para poder rastrearla.
import type { ConsumoGasolinera } from '../../hooks/useGasolineras'
import type { Gasolinera } from '../../hooks/useGasolineras'
import { crearReportePdf, hoyISO } from './pdfDoc'
import { crearLibroExcel } from './excelDoc'
import { formatMXN, formatLitros, formatFecha } from '../formato'
import { type Periodo, etiquetaPeriodo, sufijoPeriodo } from './periodo'

export interface DatosConsumoGasolinera {
  gasolinera: Gasolinera
  /** Ya filtradas por la pantalla: el reporte exporta lo que se está viendo. */
  consumos:   ConsumoGasolinera[]
  periodo:    Periodo
  busqueda?:  string
}

function nombreBase(d: DatosConsumoGasolinera): string {
  const sufijo = sufijoPeriodo(d.periodo)
  const nombre = d.gasolinera.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `consumo-${nombre}${sufijo ? `-${sufijo}` : ''}-${hoyISO()}`
}

type AnioDeConsumo = { anio: string; costo: number; litros: number; recargas: ConsumoGasolinera[] }

function agruparPorAnio(consumos: ConsumoGasolinera[]): AnioDeConsumo[] {
  const map = new Map<string, AnioDeConsumo>()
  for (const c of consumos) {
    const anio = c.fecha.slice(0, 4)
    const entry = map.get(anio) ?? { anio, costo: 0, litros: 0, recargas: [] }
    entry.costo  += c.costo
    entry.litros += c.litros
    entry.recargas.push(c)
    map.set(anio, entry)
  }
  return [...map.values()]
}

/** Cuánto carga cada unidad aquí: dónde se va el combustible de esta estación. */
type PorUnidad = { vehiculo: string; recargas: number; litros: number; costo: number }

function agruparPorUnidad(consumos: ConsumoGasolinera[]): PorUnidad[] {
  const map = new Map<number, PorUnidad>()
  for (const c of consumos) {
    const entry = map.get(c.vehiculo_id)
      ?? { vehiculo: c.vehiculo, recargas: 0, litros: 0, costo: 0 }
    entry.recargas += 1
    entry.litros   += c.litros
    entry.costo    += c.costo
    map.set(c.vehiculo_id, entry)
  }
  return [...map.values()].sort((a, b) => b.costo - a.costo)
}

function subtitulo(d: DatosConsumoGasolinera): string {
  const partes = [d.gasolinera.ubicacion, etiquetaPeriodo(d.periodo, 'Historial completo')]
  if (d.busqueda?.trim()) partes.push(`Filtro: "${d.busqueda.trim()}"`)
  return partes.filter(Boolean).join(' · ')
}

export async function exportConsumoGasolineraPdf(d: DatosConsumoGasolinera) {
  const costo   = d.consumos.reduce((s, c) => s + c.costo, 0)
  const litros  = d.consumos.reduce((s, c) => s + c.litros, 0)
  const anios   = agruparPorAnio(d.consumos)
  const unidades = agruparPorUnidad(d.consumos)

  const pdf = await crearReportePdf({
    titulo: `Consumo — ${d.gasolinera.nombre}`,
    subtitulo: subtitulo(d),
    orientacion: 'landscape',
  })

  if (d.consumos.length === 0) {
    pdf.seccion('Sin recargas en este periodo')
    pdf.vacio('No hay cargas de combustible en esta gasolinera dentro del corte elegido.')
    pdf.guardar(nombreBase(d))
    return
  }

  pdf.seccion('Resumen')
  pdf.datos([
    ['Recargas',              String(d.consumos.length)],
    ['Unidades distintas',    String(unidades.length)],
    ['Litros',                formatLitros(litros)],
    ['Primera recarga del corte', formatFecha(d.consumos[d.consumos.length - 1].fecha)],
    ['Última recarga del corte',  formatFecha(d.consumos[0].fecha)],
    ['Promedio por litro',    litros > 0 ? formatMXN(costo / litros) : '—'],
    ['Total gastado',         formatMXN(costo)],
  ], { destacarUltimo: true })
  pdf.nota(
    'El promedio por litro es el precio realmente pagado en esta estación (total entre litros), ' +
    'que es lo comparable contra otra: el total depende también de cuánto haya cargado la flota aquí.'
  )

  pdf.seccion(
    'Por unidad',
    'De mayor a menor gasto. Sirve para ver qué unidades cargan en esta estación.',
  )
  pdf.tabla({
    head: ['Unidad', 'Recargas', 'Litros', 'Total', '$/litro'],
    body: unidades.map((u) => [
      u.vehiculo, String(u.recargas), formatLitros(u.litros), formatMXN(u.costo),
      u.litros > 0 ? formatMXN(u.costo / u.litros) : '—',
    ]),
    columnStyles: {
      1: { halign: 'right' }, 2: { halign: 'right' },
      3: { halign: 'right' }, 4: { halign: 'right' },
    },
    fontSize: 9,
  })

  for (const a of anios) {
    pdf.seccion(
      `Recargas de ${a.anio}`,
      `${a.recargas.length} recarga${a.recargas.length !== 1 ? 's' : ''} · ` +
      `${formatLitros(a.litros)} · ${formatMXN(a.costo)}`,
    )
    pdf.tabla({
      head: ['Fecha', 'Unidad', 'Chofer', 'Litros', 'Costo', '$/litro', 'Vale', 'Odómetro'],
      body: a.recargas.map((r) => [
        formatFecha(r.fecha), r.vehiculo, r.conductor,
        formatLitros(r.litros), formatMXN(r.costo),
        r.litros > 0 ? formatMXN(r.costo / r.litros) : '—',
        r.vale_folio ?? '—',
        r.kilometraje != null ? `${r.kilometraje.toLocaleString('es-MX')} km` : '—',
      ]),
      columnStyles: {
        3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 7: { halign: 'right' },
      },
      fontSize: 8,
    })
  }

  pdf.guardar(nombreBase(d))
}

export async function exportConsumoGasolineraExcel(d: DatosConsumoGasolinera) {
  const wb = await crearLibroExcel()
  const costo    = d.consumos.reduce((s, c) => s + c.costo, 0)
  const litros   = d.consumos.reduce((s, c) => s + c.litros, 0)
  const unidades = agruparPorUnidad(d.consumos)

  wb.hojaResumen('Resumen', [
    ['Gasolinera',        d.gasolinera.nombre],
    ['Ubicación',         d.gasolinera.ubicacion],
    ['Periodo',           etiquetaPeriodo(d.periodo, 'Historial completo')],
    ['Filtro de texto',   d.busqueda?.trim() || '—'],
    ['Recargas',          d.consumos.length],
    ['Unidades distintas', unidades.length],
    ['Litros',            litros],
    ['Promedio por litro', litros > 0 ? costo / litros : 0],
    ['Total gastado',     costo],
  ], { moneda: [7, 8] })

  wb.hoja<ConsumoGasolinera>('Recargas', [
    { header: 'Fecha',    width: 13, formato: 'fecha',  valor: (c) => new Date(`${c.fecha}T12:00:00`) },
    { header: 'Unidad',   width: 38, valor: (c) => c.vehiculo },
    { header: 'Chofer',   width: 26, valor: (c) => c.conductor },
    { header: 'Litros',   width: 12, formato: 'litros', valor: (c) => c.litros },
    { header: 'Costo',    width: 14, formato: 'moneda', valor: (c) => c.costo },
    { header: '$/litro',  width: 12, formato: 'moneda', valor: (c) => (c.litros > 0 ? c.costo / c.litros : 0) },
    { header: 'Vale',     width: 16, valor: (c) => c.vale_folio ?? '—' },
    { header: 'Odómetro', width: 14, formato: 'numero', valor: (c) => c.kilometraje ?? 0 },
  ], d.consumos, {
    totales: { 'Litros': litros, 'Costo': costo },
    vacio: 'No hay recargas en esta gasolinera dentro del periodo elegido.',
  })

  wb.hoja<PorUnidad>('Por unidad', [
    { header: 'Unidad',   width: 38, valor: (u) => u.vehiculo },
    { header: 'Recargas', width: 12, formato: 'numero', valor: (u) => u.recargas },
    { header: 'Litros',   width: 12, formato: 'litros', valor: (u) => u.litros },
    { header: 'Total',    width: 14, formato: 'moneda', valor: (u) => u.costo },
    { header: '$/litro',  width: 12, formato: 'moneda', valor: (u) => (u.litros > 0 ? u.costo / u.litros : 0) },
  ], unidades, {
    totales: { 'Litros': litros, 'Total': costo },
    vacio: 'Sin recargas en el periodo elegido.',
  })

  await wb.guardar(`${nombreBase(d)}.xlsx`)
}
