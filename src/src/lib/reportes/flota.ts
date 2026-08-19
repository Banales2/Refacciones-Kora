// Reporte de flota: costos del periodo, comparación contra el periodo anterior
// y detalle por vehículo agrupado por ubicación.
//
// Lo nuevo aquí es el filtro. Antes salía siempre la flota completa, y quien
// administra una sucursal tenía que buscar sus unidades entre las de todas las
// demás; lo mismo el que solo quería ver los utilitarios. El filtro se aplica
// **antes** de sumar los costos, no solo al listado: un reporte de una sucursal
// cuyo total fuera el de la empresa entera sería peor que no tenerlo.
import type { ReporteFlota, VehiculoReporte, PeriodoComparacion } from '../../hooks/useDashboard'
import type { Sucursal } from '../../hooks/useSucursales'
import { agruparVehiculosPorUbicacion } from '../agruparVehiculosReporte'
import { crearReportePdf, COLOR, type CellHookData } from './pdfDoc'
import { crearLibroExcel } from './excelDoc'
import { formatMXN, formatNum, formatFecha } from '../formato'
import { TIPO_LABELS } from '../tipoVehiculo'

/**
 * Qué parte de la flota entra al reporte.
 * - `toda`:     sin filtro.
 * - `sucursal`: las unidades asignadas a una sucursal (camiones y montacargas).
 * - `tipo`:     todas las de un tipo, p. ej. solo los vehículos utilitarios.
 */
export type FiltroFlota =
  | { modo: 'toda' }
  | { modo: 'sucursal'; sucursalId: number }
  | { modo: 'tipo';     tipo: string }

export function etiquetaFiltro(filtro: FiltroFlota, sucursales: Sucursal[]): string {
  if (filtro.modo === 'sucursal') {
    return sucursales.find((s) => s.id === filtro.sucursalId)?.nombre ?? 'Sucursal'
  }
  if (filtro.modo === 'tipo') return TIPO_LABELS[filtro.tipo] ?? filtro.tipo
  return 'Flota completa'
}

function aplicarFiltro(vehiculos: VehiculoReporte[], filtro: FiltroFlota): VehiculoReporte[] {
  if (filtro.modo === 'sucursal') return vehiculos.filter((v) => v.sucursal_id === filtro.sucursalId)
  if (filtro.modo === 'tipo')     return vehiculos.filter((v) => v.tipo === filtro.tipo)
  return vehiculos
}

interface Totales {
  mano_obra:    number
  piezas:       number
  total:        number
  mantenimientos: number
  vencidos:     number
  por_vencer:   number
}

// Con filtro los totales se recalculan desde los vehículos que quedaron; sin
// filtro se usan los del backend, que además incluyen las refacciones compradas
// (esas no cuelgan de ningún vehículo, así que no se pueden repartir).
function totalesDe(vehiculos: VehiculoReporte[]): Totales {
  return vehiculos.reduce<Totales>((acc, v) => ({
    mano_obra:      acc.mano_obra      + v.costo_mano_obra_mes,
    piezas:         acc.piezas         + v.costo_piezas_mes,
    total:          acc.total          + v.costo_mano_obra_mes + v.costo_piezas_mes,
    mantenimientos: acc.mantenimientos + v.mantenimientos_mes,
    vencidos:       acc.vencidos       + v.vencidos,
    por_vencer:     acc.por_vencer     + v.por_vencer,
  }), { mano_obra: 0, piezas: 0, total: 0, mantenimientos: 0, vencidos: 0, por_vencer: 0 })
}

function rangoMesLabel(rango: { start: string }): string {
  return new Date(`${rango.start}T12:00:00`)
    .toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
}

function rangoCortoLabel(rango: { start: string; end: string }): string {
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

function periodoLabel(periodo: PeriodoComparacion): string {
  return periodo === 'semana' ? 'la semana' : 'el mes'
}

function nombreBase(reporte: ReporteFlota, filtro: FiltroFlota): string {
  const sufijo = filtro.modo === 'toda' ? 'completa'
    : filtro.modo === 'tipo' ? filtro.tipo
    : `sucursal-${filtro.sucursalId}`
  return `reporte-flota-${sufijo}-${reporte.rango_costos.start.slice(0, 7)}`
}

const NOTA_COSTOS =
  'Las refacciones usadas no entran en el total: ya se pagaron al comprarlas, y sumarlas otra vez ' +
  'las cobraría dos veces.'

export async function exportReporteFlotaPdf(
  reporte: ReporteFlota, sucursales: Sucursal[], filtro: FiltroFlota = { modo: 'toda' },
) {
  const vehiculos = aplicarFiltro(reporte.vehiculos, filtro)
  const t = totalesDe(vehiculos)
  const parcial = filtro.modo !== 'toda'
  const alcance = etiquetaFiltro(filtro, sucursales)

  const pdf = await crearReportePdf({
    titulo: parcial ? `Reporte de flotilla — ${alcance}` : 'Reporte de flotilla',
    subtitulo: `Costos de ${rangoMesLabel(reporte.rango_costos)} · ${vehiculos.length} unidad${vehiculos.length !== 1 ? 'es' : ''}`,
    orientacion: 'landscape',
  })

  pdf.seccion('Costos del periodo')
  if (parcial) {
    // Con filtro no se puede reportar la compra de refacciones: los lotes entran
    // al almacén, no a una sucursal. Decirlo es preferible a repartirlos con un
    // criterio inventado.
    pdf.datos([
      ['Mano de obra', formatMXN(t.mano_obra)],
      ['Refacciones usadas en mantenimientos', formatMXN(t.piezas)],
      ['Costo de mantenimiento del alcance seleccionado', formatMXN(t.total)],
    ], { destacarUltimo: true })
    pdf.nota(
      `Solo se cuentan las ${vehiculos.length} unidades de ${alcance}. Las refacciones compradas ` +
      'no aparecen aquí: los lotes entran al almacén general y no pertenecen a una sucursal ni a ' +
      'un tipo de unidad en particular. Para la salida de caja completa, usa el reporte de la flota entera.'
    )
  } else {
    pdf.datos([
      ['Mano de obra (mantenimiento sin refacciones)', formatMXN(reporte.costos.mano_obra)],
      ['Refacciones usadas en mantenimientos', formatMXN(reporte.costos.piezas_usadas)],
      ['Subtotal mantenimiento', formatMXN(reporte.costos.total_mantenimiento)],
      ['Refacciones compradas (lotes del periodo)', formatMXN(reporte.costos.piezas_compradas)],
      ['Costo total (mano de obra + refacciones compradas)', formatMXN(reporte.costos.total)],
    ], { destacarUltimo: true })
    pdf.nota(NOTA_COSTOS)
  }

  pdf.seccion(`Comparación vs ${periodoLabel(reporte.periodo)} anterior`)
  pdf.nota(
    `${rangoCortoLabel(reporte.comparacion.rango_actual)}  vs  ${rangoCortoLabel(reporte.comparacion.rango_anterior)}`
  )
  if (parcial) {
    // La comparación del backend es de la flota entera; con filtro se reporta
    // el estado del alcance de hoy, sin inventar un histórico que no existe.
    pdf.datos([
      ['Requerimientos vencidos en el alcance', String(t.vencidos)],
      ['Requerimientos por vencer en el alcance', String(t.por_vencer)],
      ['Mantenimientos realizados', String(t.mantenimientos)],
    ])
    pdf.nota(
      'La comparación contra el periodo anterior solo se lleva para la flota completa, así que ' +
      'aquí se reporta el estado actual del alcance seleccionado.'
    )
  } else {
    pdf.datos([[
      'Requerimientos vencidos',
      `${reporte.comparacion.vencidos_actual} ${deltaLabel(reporte.comparacion.vencidos_actual, reporte.comparacion.vencidos_anterior)}`,
    ]])
  }

  // ── Detalle por vehículo ──
  const grupos = agruparVehiculosPorUbicacion(vehiculos, sucursales)
  if (grupos.length === 0) {
    pdf.seccion('Detalle por vehículo')
    pdf.vacio(`No hay unidades en ${alcance}.`)
  }

  for (const grupo of grupos) {
    pdf.seccion(grupo.label)
    for (const sub of grupo.tipos) {
      pdf.subseccion(`${sub.label} (${sub.items.length})`)
      pdf.tabla({
        head: [
          'Marca / Modelo', 'Serie', 'Placas', 'Estatus', 'Km',
          'Mttos.', 'Mano obra', 'Refacc.', 'Vencidos', 'Por vencer', 'Último mtto.',
        ],
        body: sub.items.map((v) => [
          `${v.marca} ${v.modelo}`,
          v.serie,
          v.placas ?? '—',
          v.status ?? '—',
          v.kilometraje != null ? `${formatNum(v.kilometraje)} km` : '—',
          String(v.mantenimientos_mes),
          formatMXN(v.costo_mano_obra_mes),
          formatMXN(v.costo_piezas_mes),
          String(v.vencidos),
          String(v.por_vencer),
          v.ultimo_mantenimiento ? formatFecha(v.ultimo_mantenimiento) : '—',
        ]),
        columnStyles: {
          4: { halign: 'right' },  5: { halign: 'center' }, 6: { halign: 'right' },
          7: { halign: 'right' },  8: { halign: 'center' }, 9: { halign: 'center' },
        },
        didParseCell: (data: CellHookData) => {
          if (data.section !== 'body') return
          if (data.column.index === 8 && Number(data.cell.raw) > 0) {
            data.cell.styles.textColor = COLOR.rojo
            data.cell.styles.fontStyle = 'bold'
          }
          if (data.column.index === 9 && Number(data.cell.raw) > 0) {
            data.cell.styles.textColor = COLOR.naranja
          }
        },
      })
    }
  }

  pdf.guardar(nombreBase(reporte, filtro))
}

export async function exportReporteFlotaExcel(
  reporte: ReporteFlota, sucursales: Sucursal[], filtro: FiltroFlota = { modo: 'toda' },
) {
  const vehiculos = aplicarFiltro(reporte.vehiculos, filtro)
  const t = totalesDe(vehiculos)
  const parcial = filtro.modo !== 'toda'
  const alcance = etiquetaFiltro(filtro, sucursales)
  const wb = await crearLibroExcel()

  const resumen: [string, string | number][] = [
    ['Alcance del reporte', alcance],
    ['Unidades incluidas', vehiculos.length],
    ['Periodo de costos', rangoMesLabel(reporte.rango_costos)],
    ['', ''],
    ['Mano de obra', t.mano_obra],
    ['Refacciones usadas en mantenimientos', t.piezas],
    ['Costo de mantenimiento del alcance', t.total],
    ['Mantenimientos realizados', t.mantenimientos],
    ['Requerimientos vencidos', t.vencidos],
    ['Requerimientos por vencer', t.por_vencer],
  ]
  if (!parcial) {
    resumen.push(
      ['', ''],
      ['Refacciones compradas (lotes del periodo)', reporte.costos.piezas_compradas],
      ['Costo total (mano de obra + refacciones compradas)', reporte.costos.total],
      ['Nota', NOTA_COSTOS],
    )
  } else {
    resumen.push(
      ['', ''],
      ['Nota', 'Las refacciones compradas no se reparten por sucursal ni por tipo: los lotes entran ' +
               'al almacén general. Para la salida de caja completa usa el reporte de la flota entera.'],
    )
  }
  wb.hojaResumen('Resumen', resumen, { moneda: parcial ? [4, 5, 6] : [4, 5, 6, 11, 12] })

  wb.hoja('Vehículos', [
    { header: 'Ubicación',      width: 22, valor: (v) => v.sucursal ?? v.ruta ?? v.ubicacion ?? '—' },
    { header: 'Tipo',           width: 20, valor: (v) => TIPO_LABELS[v.tipo] ?? v.tipo },
    { header: 'Marca',          width: 18, valor: (v) => v.marca },
    { header: 'Modelo',         width: 22, valor: (v) => v.modelo },
    { header: 'Serie',          width: 24, valor: (v) => v.serie },
    { header: 'Placas',         width: 14, valor: (v) => v.placas ?? '—' },
    { header: 'Estatus',        width: 14, valor: (v) => v.status ?? '—' },
    { header: 'Kilometraje',    width: 14, formato: 'numero', valor: (v) => v.kilometraje ?? 0 },
    { header: 'Mantenimientos', width: 15, formato: 'numero', valor: (v) => v.mantenimientos_mes },
    { header: 'Mano de obra',   width: 15, formato: 'moneda', valor: (v) => v.costo_mano_obra_mes },
    { header: 'Refacciones',    width: 15, formato: 'moneda', valor: (v) => v.costo_piezas_mes },
    { header: 'Costo total',    width: 15, formato: 'moneda', valor: (v) => v.costo_mano_obra_mes + v.costo_piezas_mes },
    { header: 'Vencidos',       width: 11, formato: 'numero', valor: (v) => v.vencidos },
    { header: 'Por vencer',     width: 12, formato: 'numero', valor: (v) => v.por_vencer },
    { header: 'Último mtto.',   width: 14, formato: 'fecha',
      valor: (v) => v.ultimo_mantenimiento ? new Date(`${v.ultimo_mantenimiento.split('T')[0]}T12:00:00`) : null },
  ], vehiculos, {
    totales: {
      'Ubicación': 'Total',
      'Mantenimientos': t.mantenimientos,
      'Mano de obra': t.mano_obra,
      'Refacciones': t.piezas,
      'Costo total': t.total,
      'Vencidos': t.vencidos,
      'Por vencer': t.por_vencer,
    },
    vacio: `No hay unidades en ${alcance}.`,
  })

  await wb.guardar(nombreBase(reporte, filtro))
}
