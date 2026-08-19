// Reporte de flota: costos del periodo, comparación contra el periodo anterior
// y detalle por vehículo agrupado por ubicación.
//
// Lo nuevo aquí es el filtro. Antes salía siempre la flota completa, y quien
// administra una sucursal tenía que buscar sus unidades entre las de todas las
// demás; lo mismo el que solo quería ver los utilitarios. El filtro se aplica
// **antes** de sumar los costos, no solo al listado: un reporte de una sucursal
// cuyo total fuera el de la empresa entera sería peor que no tenerlo.
import type { ReporteFlota, VehiculoReporte } from '../../hooks/useDashboard'
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

// El rango de costos ya no es siempre el mes en curso: puede ser un año o dos
// fechas elegidas a mano. Cuando cubre un mes calendario exacto se sigue
// nombrando "agosto de 2026", que es como se dice; en cualquier otro caso se
// imprimen las dos fechas, porque "agosto" sería mentira.
function rangoMesLabel(rango: { start: string; end: string }): string {
  const inicio = new Date(`${rango.start}T12:00:00`)
  const fin    = new Date(`${rango.end}T12:00:00`)
  const finIncl = new Date(fin)
  finIncl.setDate(finIncl.getDate() - 1)

  const mesExacto = inicio.getDate() === 1 && fin.getDate() === 1 &&
    (fin.getMonth() !== inicio.getMonth() || fin.getFullYear() !== inicio.getFullYear()) &&
    finIncl.getMonth() === inicio.getMonth() && finIncl.getFullYear() === inicio.getFullYear()
  if (mesExacto) return inicio.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })

  const anioExacto = inicio.getMonth() === 0 && inicio.getDate() === 1 &&
    finIncl.getMonth() === 11 && finIncl.getDate() === 31 &&
    finIncl.getFullYear() === inicio.getFullYear()
  if (anioExacto) return String(inicio.getFullYear())

  const fmt = (d: Date) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${fmt(inicio)} – ${fmt(finIncl)}`
}

// Lleva el año cuando la ventana no cabe en uno solo o no es el actual: sin él,
// la comparación de un reporte de 2025 se leía "01 ene – 31 dic" contra
// "01 ene – 31 dic", dos veces lo mismo.
function rangoCortoLabel(rango: { start: string; end: string }): string {
  const inicio = new Date(`${rango.start}T12:00:00`)
  const finIncl = new Date(`${rango.end}T12:00:00`)
  finIncl.setDate(finIncl.getDate() - 1)
  const conAnio = inicio.getFullYear() !== finIncl.getFullYear() ||
                  inicio.getFullYear() !== new Date().getFullYear()
  const fmt = (d: Date) => d.toLocaleDateString('es-MX',
    conAnio ? { day: '2-digit', month: 'short', year: 'numeric' } : { day: '2-digit', month: 'short' })
  return `${fmt(inicio)} – ${fmt(finIncl)}`
}

function deltaLabel(actual: number | null, anterior: number | null): string {
  if (actual === null || anterior === null) return '(sin historial suficiente para comparar)'
  const delta = actual - anterior
  if (delta === 0) return '(sin cambio vs periodo anterior)'
  return `(${delta > 0 ? '+' : ''}${delta} vs periodo anterior)`
}

// Cómo se llama la ventana comparada. Con un rango elegido a mano ya no es "el
// mes" ni "la semana", así que se nombra genérico y las fechas exactas van en
// el renglón de abajo, que es donde se pueden leer sin ambigüedad.
function tituloComparacion(reporte: ReporteFlota, conRango: boolean): string {
  if (conRango) return 'Comparación contra el periodo anterior'
  return `Comparación vs ${reporte.periodo === 'semana' ? 'la semana' : 'el mes'} anterior`
}

function nombreBase(reporte: ReporteFlota, filtro: FiltroFlota): string {
  const sufijo = filtro.modo === 'toda' ? 'completa'
    : filtro.modo === 'tipo' ? filtro.tipo
    : `sucursal-${filtro.sucursalId}`
  return `reporte-flota-${sufijo}-${reporte.rango_costos.start}`
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

  // El periodo de la comparación es el mismo de los costos cuando se pidió un
  // rango; con eso el reporte deja de mezclar dos ventanas distintas.
  const comp = reporte.comparacion
  const conRango = comp.rango_actual.start === reporte.rango_costos.start &&
                   comp.rango_actual.end   === reporte.rango_costos.end
  pdf.seccion(tituloComparacion(reporte, conRango))
  pdf.nota(
    `${rangoCortoLabel(comp.rango_actual)}  vs  ${rangoCortoLabel(comp.rango_anterior)}`
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
      comp.origen_actual === 'historico'
        ? 'Requerimientos vencidos al cierre del periodo'
        : 'Requerimientos vencidos hoy',
      comp.vencidos_actual === null
        ? 'sin dato'
        : `${comp.vencidos_actual} ${deltaLabel(comp.vencidos_actual, comp.vencidos_anterior)}`,
    ]])
    if (comp.origen_actual === 'historico') {
      pdf.nota(
        comp.vencidos_actual === null
          ? 'El periodo ya cerró y no hay registro diario de vencidos de esas fechas: el conteo ' +
            'empezó a guardarse después. Los costos de arriba sí son del periodo completo.'
          : 'El periodo ya cerró, así que el conteo es el que se registró al cierre y no el de hoy: ' +
            'los vencidos de entonces ya se atendieron o siguen abiertos, pero son otro número.'
      )
    }
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
