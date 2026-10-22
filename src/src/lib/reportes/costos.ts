// Reporte de la pestaña Costos y ahorro.
//
// Es el que va dirigido a quien autoriza el gasto, así que abre con lo
// accionable —cuánto se puede dejar de gastar y dónde— y deja el detalle
// operativo después. El orden de la pantalla se respeta para que quien lo
// reciba pueda seguirlo en el sistema renglón por renglón.
import type { AnalisisCostos, TipoAnomalia } from '../../hooks/useDashboard'
import { crearReportePdf, COLOR, type CellHookData } from './pdfDoc'
import { crearLibroExcel } from './excelDoc'
import { formatMXN, formatNum, formatLitros, formatFecha, formatMes } from '../formato'
import { TIPO_LABELS } from '../tipoVehiculo'
import { SIN_PRODUCTO } from '../combustible'

const ANOMALIA_LABEL: Record<TipoAnomalia, string> = {
  rendimiento_bajo:   'Rendimiento bajo',
  odometro_retrocede: 'Odómetro inconsistente',
  precio_alto:        'Precio por litro alto',
  precio_bajo:        'Precio por litro sospechosamente bajo',
  carga_duplicada:    'Dos cargas el mismo día',
  sin_vale:           'Carga sin vale',
  sin_odometro:       'Carga sin kilometraje',
}

// `rango.end` es exclusivo: el último día que entró al análisis es el anterior.
function ultimoDia(a: AnalisisCostos): string {
  const d = new Date(`${a.rango.end}T12:00:00`)
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** PASE factura cada diez días: si su último cruce facturado no llega al fin del periodo, faltan casetas. */
export function casetasIncompletas(a: AnalisisCostos): boolean {
  return a.totales.casetas_hasta != null && a.totales.casetas_hasta < ultimoDia(a)
}

// Se nombra el periodo por sus dos fechas y no como "últimos N días", porque
// ahora puede ser un año cerrado o un rango elegido a mano: en un documento que
// se archiva, "últimos 90 días" deja de querer decir nada al mes siguiente.
function subtitulo(a: AnalisisCostos): string {
  return `Del ${formatFecha(a.rango.start)} al ${formatFecha(ultimoDia(a))} · ${a.rango.dias} días`
}

function nombreBase(a: AnalisisCostos): string {
  return `costos-y-ahorro-${a.rango.start}_${ultimoDia(a)}`
}

function km(v: number | null): string {
  return v != null ? `${formatNum(v)} km` : '—'
}

export async function exportCostosPdf(a: AnalisisCostos) {
  const t = a.totales
  const pdf = await crearReportePdf({
    titulo: 'Análisis de costos y ahorro de la flota',
    subtitulo: subtitulo(a),
    orientacion: 'landscape',
  })

  // ── Lo accionable primero ──
  pdf.seccion('Ahorro identificado')
  pdf.datos([
    ['Comprando cada refacción con el proveedor más barato', formatMXN(t.ahorro_refacciones)],
    ['Cargando siempre en la gasolinera más económica de las que ya se visitan', formatMXN(t.ahorro_combustible)],
    ['Total recuperable en el periodo', formatMXN(t.ahorro_total)],
  ], { destacarUltimo: true })
  pdf.nota(
    'Es ahorro alcanzable sin dejar de operar: se compara contra proveedores y gasolineras ' +
    'con los que ya se trabaja, no contra un precio ideal de mercado.'
  )

  pdf.seccion('Gasto del periodo')
  pdf.datos([
    ['Combustible', formatMXN(t.combustible)],
    ['Mano de obra', formatMXN(t.mano_obra)],
    ['Refacciones compradas', formatMXN(t.refacciones_compradas)],
    ['Casetas', formatMXN(t.casetas)],
    ['Salida de caja', formatMXN(t.total_caja)],
  ], { destacarUltimo: true })
  if (casetasIncompletas(a)) {
    pdf.nota(
      `PASE factura cada diez días: las casetas están facturadas hasta el ${formatFecha(t.casetas_hasta!)}. ` +
      'Los cruces posteriores todavía no se suman.'
    )
  }
  pdf.datos([
    ['Kilómetros recorridos', km(t.km_recorridos)],
    ['Costo por kilómetro', t.costo_por_km != null ? formatMXN(t.costo_por_km) : '—'],
    ['Litros cargados', `${formatLitros(t.litros)} L`],
    ['Rendimiento de la flota', t.rendimiento != null ? `${t.rendimiento.toFixed(2)} km/L` : '—'],
    ['Precio por litro (promedio ponderado)', t.precio_litro != null ? `$${t.precio_litro.toFixed(2)}` : '—'],
    ...a.precios_litro.map((p): [string, string] => [
      `Precio por litro · ${p.producto}`,
      p.precio_litro != null ? `$${p.precio_litro.toFixed(2)}` : '—',
    ]),
  ])

  // ── Refacciones ──
  pdf.seccion(
    'Refacciones que se están comprando caras',
    'Compras del periodo contra el precio vigente más bajo cotizado para la misma refacción.',
  )
  if (a.ahorro_refacciones.length === 0) {
    pdf.vacio('Ninguna compra del periodo salió más cara que el mejor precio cotizado.')
  } else {
    pdf.tabla({
      head: ['Refacción', 'Descripción', 'Se le compró a', 'Más barato con', 'Pagado', 'Mejor precio', 'Cant.', 'Ahorro'],
      body: [
        ...a.ahorro_refacciones.map((o) => [
          o.numero_serie, o.descripcion, o.proveedor, o.mejor_proveedor,
          formatMXN(o.pagado), formatMXN(o.mejor_precio), String(o.cantidad), formatMXN(o.ahorro),
        ]),
        ['Total', '', '', '', '', '', '', formatMXN(t.ahorro_refacciones)],
      ],
      columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'center' }, 7: { halign: 'right' } },
      totalAlFinal: true,
    })
  }

  // ── Gasolineras ──
  pdf.seccion(
    'Precio por litro por gasolinera',
    'El sobreprecio es lo pagado de más contra la gasolinera más barata de las que ya se visitan con regularidad, ' +
    'en el mismo combustible. Las cargas sin combustible especificado no se comparan.',
  )
  if (a.gasolineras.length === 0) {
    pdf.vacio('Sin recargas registradas en el periodo.')
  } else {
    pdf.tabla({
      head: ['Gasolinera', 'Combustible', 'Cargas', 'Litros', 'Gasto', '$/L', 'Sobreprecio'],
      body: [
        ...a.gasolineras.map((g) => [
          g.gasolinera, g.producto, String(g.recargas), formatLitros(g.litros), formatMXN(g.costo),
          g.precio_litro != null ? `$${g.precio_litro.toFixed(2)}` : '—',
          g.sobreprecio > 0 ? formatMXN(g.sobreprecio)
            : g.producto === SIN_PRODUCTO ? '—' : 'la más barata',
        ]),
        ['Total', '', '', '', '', '', formatMXN(t.ahorro_combustible)],
      ],
      columnStyles: {
        2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' },
      },
      totalAlFinal: true,
      fontSize: 9,
    })
  }

  // ── Sucursales ──
  pdf.seccion(
    'Sucursales lado a lado',
    'Cada unidad cuenta en la sucursal donde tiene base. Se comparan el costo por km (solo unidades con kilometraje) ' +
    'y la eficiencia contra el promedio del modelo de cada unidad. "Sin base fija": tractocamiones, unidades que rotan ' +
    'y utilitarios sin sucursal asignada.',
  )
  if (a.sucursales.length === 0) {
    pdf.vacio('Sin movimiento registrado en el periodo.')
  } else {
    pdf.tabla({
      head: ['Sucursal', 'Unidades', 'Km', 'Combustible', '$/L', 'Taller', 'Casetas', 'Total',
             'Costo/km', 'km/L', 'Vs. modelo', 'Sobrecosto anual'],
      body: a.sucursales.map((s) => [
        s.sucursal, `${s.unidades} de ${s.unidades_flota}`, km(s.km_recorridos || null),
        formatMXN(s.combustible), s.precio_litro != null ? `$${s.precio_litro.toFixed(2)}` : '—',
        formatMXN(s.mano_obra + s.refacciones), formatMXN(s.casetas), formatMXN(s.total),
        s.costo_por_km != null ? formatMXN(s.costo_por_km) : '—',
        s.rendimiento != null ? s.rendimiento.toFixed(2) : '—',
        s.eficiencia_pct != null ? `${s.eficiencia_pct > 0 ? '+' : ''}${s.eficiencia_pct.toFixed(1)}%` : '—',
        s.sobrecosto_anual > 0 ? formatMXN(s.sobrecosto_anual) : '—',
      ]),
      columnStyles: {
        1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' },
        9: { halign: 'right' }, 10: { halign: 'right' }, 11: { halign: 'right' },
      },
      fontSize: 8,
    })
  }

  // ── Costo por kilómetro ──
  pdf.seccion(
    'Costo por kilómetro, unidad por unidad',
    'Todo lo que consumió la unidad entre los kilómetros que avanzó su odómetro en el periodo.',
  )
  if (a.vehiculos.length === 0) {
    pdf.vacio('Sin movimiento registrado en el periodo.')
  } else {
    pdf.tabla({
      head: ['Vehículo', 'Tipo', 'Km', 'Combustible', 'Taller', 'Casetas', 'Total', 'Costo/km', 'Mttos.', 'Cargas'],
      body: a.vehiculos.map((v) => [
        v.vehiculo, TIPO_LABELS[v.tipo] ?? v.tipo, km(v.km_recorridos),
        formatMXN(v.combustible), formatMXN(v.mano_obra + v.refacciones), formatMXN(v.casetas),
        formatMXN(v.total),
        v.costo_por_km != null ? formatMXN(v.costo_por_km) : '—',
        String(v.mantenimientos), String(v.recargas),
      ]),
      columnStyles: {
        2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
        8: { halign: 'center' }, 9: { halign: 'center' },
      },
    })
  }

  // ── Rendimiento ──
  const conRendimiento = a.vehiculos
    .filter((v) => v.rendimiento != null)
    .sort((x, y) => (x.desviacion_pct ?? 0) - (y.desviacion_pct ?? 0))
  pdf.seccion(
    'Rendimiento contra las unidades del mismo modelo',
    'Una unidad muy por debajo de sus gemelas suele traer algo mecánico o combustible que no llega al tanque. ' +
    'El sobrecosto anual extrapola el faltante del periodo a doce meses.',
  )
  if (conRendimiento.length === 0) {
    pdf.vacio('Hacen falta al menos tres cargas con kilometraje capturado por unidad para medir el rendimiento.')
  } else {
    pdf.tabla({
      head: ['Vehículo', 'Modelo', 'km/L', 'Promedio del modelo', 'Diferencia', 'Sobrecosto anual'],
      body: conRendimiento.map((v) => [
        v.vehiculo, v.modelo, v.rendimiento!.toFixed(2),
        v.rendimiento_modelo != null ? v.rendimiento_modelo.toFixed(2) : '—',
        v.desviacion_pct != null ? `${v.desviacion_pct > 0 ? '+' : ''}${v.desviacion_pct.toFixed(1)}%` : '—',
        v.sobrecosto_anual != null && v.sobrecosto_anual > 0 ? formatMXN(v.sobrecosto_anual) : '—',
      ]),
      columnStyles: {
        2: { halign: 'right' }, 3: { halign: 'right' },
        4: { halign: 'center' }, 5: { halign: 'right' },
      },
      // Se marca en rojo lo que ya cae en el umbral de revisión, para que
      // salte en una hoja impresa donde no hay color de fondo que ayude.
      didParseCell: (d: CellHookData) => {
        if (d.section !== 'body' || d.column.index !== 4) return
        const pct = parseFloat(String(d.cell.raw).replace('%', ''))
        if (pct <= -15) { d.cell.styles.textColor = COLOR.rojo; d.cell.styles.fontStyle = 'bold' }
        else if (pct < -5) d.cell.styles.textColor = COLOR.naranja
      },
      fontSize: 9,
    })
  }

  // ── Retrabajos ──
  const retrabajoTotal = a.retrabajos.reduce((s, r) => s + r.costo, 0)
  pdf.seccion(
    'Servicios que se repitieron',
    'El mismo servicio hecho dos veces a la misma unidad en menos de un mes: trabajo que se pagó dos veces.',
  )
  if (a.retrabajos.length === 0) {
    pdf.vacio('Ningún servicio se repitió en menos de 30 días.')
  } else {
    pdf.tabla({
      head: ['Vehículo', 'Servicio', 'Primera vez', 'Se repitió', 'Días', 'Costo repetido'],
      body: [
        ...a.retrabajos.map((r) => [
          r.vehiculo, r.tipo, formatFecha(r.fecha_previa), formatFecha(r.fecha),
          String(r.dias), formatMXN(r.costo),
        ]),
        ['Total', '', '', '', '', formatMXN(retrabajoTotal)],
      ],
      columnStyles: { 4: { halign: 'center' }, 5: { halign: 'right' } },
      totalAlFinal: true,
      fontSize: 9,
    })
  }

  // ── Anomalías ──
  pdf.seccion(
    'Cargas de combustible que conviene revisar',
    'No todas son un problema —una carga sin vale puede ser captura pendiente—, pero son las que hay que ' +
    'mirar antes de firmar el gasto. El importe es lo que costó la carga, salvo en el rendimiento bajo, que se anualiza.',
  )
  if (a.anomalias.length === 0) {
    pdf.vacio('Ninguna carga del periodo levanta bandera.')
  } else {
    pdf.tabla({
      head: ['Tipo', 'Cantidad', 'Importe'],
      body: a.anomalias_resumen.map((r) => [
        ANOMALIA_LABEL[r.tipo], String(r.cantidad),
        r.monto > 0 ? formatMXN(r.monto) + (r.tipo === 'rendimiento_bajo' ? '/año' : '') : '—',
      ]),
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } },
      fontSize: 9,
    })
    pdf.subseccion(`Detalle (${a.anomalias.length} registros, de mayor a menor impacto)`)
    pdf.tabla({
      head: ['Tipo', 'Vehículo', 'Fecha', 'Detalle', 'Importe'],
      body: a.anomalias.map((an) => [
        ANOMALIA_LABEL[an.tipo], an.vehiculo, formatFecha(an.fecha), an.detalle,
        an.monto != null && an.monto > 0
          ? formatMXN(an.monto) + (an.tipo === 'rendimiento_bajo' ? '/año' : '')
          : '—',
      ]),
      columnStyles: { 4: { halign: 'right' } },
      didParseCell: (d: CellHookData) => {
        if (d.section !== 'body' || d.column.index !== 0) return
        const label = String(d.cell.raw)
        if (label === ANOMALIA_LABEL.rendimiento_bajo || label === ANOMALIA_LABEL.odometro_retrocede) {
          d.cell.styles.textColor = COLOR.rojo
        }
      },
    })
  }

  pdf.guardar(nombreBase(a))
}

export async function exportCostosExcel(a: AnalisisCostos) {
  const t = a.totales
  const wb = await crearLibroExcel()

  wb.hojaResumen('Resumen', [
    ['Periodo analizado', `Del ${formatFecha(a.rango.start)} al ${formatFecha(ultimoDia(a))} (${a.rango.dias} días)`],
    ['Unidades con movimiento', t.vehiculos_analizados],
    ['', ''],
    ['AHORRO IDENTIFICADO', ''],
    ['Refacciones (comprando con el proveedor más barato)', t.ahorro_refacciones],
    ['Combustible (cargando en la gasolinera más económica)', t.ahorro_combustible],
    ['Total recuperable', t.ahorro_total],
    ['', ''],
    ['GASTO DEL PERIODO', ''],
    ['Combustible', t.combustible],
    ['Mano de obra', t.mano_obra],
    ['Refacciones compradas', t.refacciones_compradas],
    ['Casetas', t.casetas],
    ['Salida de caja', t.total_caja],
    ['', ''],
    ['OPERACIÓN', ''],
    ['Kilómetros recorridos', t.km_recorridos],
    ['Costo por kilómetro', t.costo_por_km ?? 0],
    ['Litros cargados', t.litros],
    ['Rendimiento de la flota (km/L)', t.rendimiento ?? 0],
    ['Precio por litro (promedio ponderado)', t.precio_litro ?? 0],
  ], { moneda: [4, 5, 6, 9, 10, 11, 12, 13, 17, 20] })

  wb.hoja('Gasto mensual', [
    { header: 'Mes',         width: 14, valor: (g) => formatMes(g.mes) },
    { header: 'Combustible', width: 16, formato: 'moneda', valor: (g) => g.combustible },
    { header: 'Mano de obra',width: 16, formato: 'moneda', valor: (g) => g.mano_obra },
    { header: 'Refacciones', width: 16, formato: 'moneda', valor: (g) => g.refacciones },
    { header: 'Casetas',     width: 16, formato: 'moneda', valor: (g) => g.casetas },
    { header: 'Total',       width: 16, formato: 'moneda', valor: (g) => g.combustible + g.mano_obra + g.refacciones + g.casetas },
  ], a.gasto_mensual, { vacio: 'Sin historial de gasto todavía.' })

  wb.hoja('Ahorro refacciones', [
    { header: 'Refacción',       width: 22, valor: (o) => o.numero_serie },
    { header: 'Descripción',     width: 36, valor: (o) => o.descripcion },
    { header: 'Se le compró a',  width: 26, valor: (o) => o.proveedor },
    { header: 'Más barato con',  width: 26, valor: (o) => o.mejor_proveedor },
    { header: 'Pagado',          width: 14, formato: 'moneda', valor: (o) => o.pagado },
    { header: 'Mejor precio',    width: 14, formato: 'moneda', valor: (o) => o.mejor_precio },
    { header: 'Cantidad',        width: 11, formato: 'numero', valor: (o) => o.cantidad },
    { header: 'Ahorro',          width: 14, formato: 'moneda', valor: (o) => o.ahorro },
  ], a.ahorro_refacciones, {
    totales: { 'Refacción': 'Total', 'Ahorro': t.ahorro_refacciones },
    vacio: 'Ninguna compra del periodo salió más cara que el mejor precio cotizado.',
  })

  wb.hoja('Gasolineras', [
    { header: 'Gasolinera',  width: 30, valor: (g) => g.gasolinera },
    { header: 'Combustible', width: 16, valor: (g) => g.producto },
    { header: 'Cargas',      width: 10, formato: 'numero',  valor: (g) => g.recargas },
    { header: 'Litros',      width: 12, formato: 'litros', valor: (g) => g.litros },
    { header: 'Gasto',       width: 15, formato: 'moneda',  valor: (g) => g.costo },
    { header: 'Precio/litro',width: 13, formato: 'moneda',  valor: (g) => g.precio_litro ?? 0 },
    { header: 'Sobreprecio', width: 15, formato: 'moneda',  valor: (g) => g.sobreprecio },
  ], a.gasolineras, {
    totales: { 'Gasolinera': 'Total', 'Sobreprecio': t.ahorro_combustible },
    vacio: 'Sin recargas registradas en el periodo.',
  })

  wb.hoja('Sucursales', [
    { header: 'Sucursal',             width: 22, valor: (s) => s.sucursal },
    { header: 'Unidades',             width: 10, formato: 'numero',  valor: (s) => s.unidades_flota },
    { header: 'Con movimiento',       width: 15, formato: 'numero',  valor: (s) => s.unidades },
    { header: 'Con kilometraje',      width: 15, formato: 'numero',  valor: (s) => s.unidades_con_km },
    { header: 'Km recorridos',        width: 14, formato: 'numero',  valor: (s) => s.km_recorridos },
    { header: 'Combustible',          width: 14, formato: 'moneda',  valor: (s) => s.combustible },
    { header: 'Litros',               width: 11, formato: 'litros',  valor: (s) => s.litros },
    { header: 'Precio por litro',     width: 15, formato: 'moneda',  valor: (s) => s.precio_litro ?? 0 },
    { header: 'Mano de obra',         width: 14, formato: 'moneda',  valor: (s) => s.mano_obra },
    { header: 'Refacciones usadas',   width: 16, formato: 'moneda',  valor: (s) => s.refacciones },
    { header: 'Casetas',              width: 14, formato: 'moneda',  valor: (s) => s.casetas },
    { header: 'Total',                width: 14, formato: 'moneda',  valor: (s) => s.total },
    { header: 'Gasto por unidad',     width: 16, formato: 'moneda',  valor: (s) => s.gasto_por_unidad ?? 0 },
    { header: 'Costo por km',         width: 13, formato: 'moneda',  valor: (s) => s.costo_por_km ?? 0 },
    { header: 'Combustible por km',   width: 18, formato: 'moneda',  valor: (s) => s.combustible_por_km ?? 0 },
    { header: 'km/L',                 width: 10, formato: 'decimal', valor: (s) => s.rendimiento ?? 0 },
    { header: 'Contra su modelo %',   width: 17, formato: 'porcentaje', valor: (s) => s.eficiencia_pct ?? 0 },
    { header: 'Sobrecosto anual',     width: 16, formato: 'moneda',  valor: (s) => s.sobrecosto_anual },
    { header: 'Cargas sin vale',      width: 15, formato: 'numero',  valor: (s) => s.sin_vale },
    { header: 'Cargas sin km',        width: 14, formato: 'numero',  valor: (s) => s.sin_odometro },
  ], a.sucursales, { vacio: 'Sin movimiento registrado en el periodo.' })

  wb.hoja('Costo por vehículo', [
    { header: 'Vehículo',            width: 34, valor: (v) => v.vehiculo },
    { header: 'Tipo',                width: 20, valor: (v) => TIPO_LABELS[v.tipo] ?? v.tipo },
    { header: 'Sucursal',            width: 20, valor: (v) => v.sucursal ?? 'Sin base fija' },
    { header: 'Modelo',              width: 26, valor: (v) => v.modelo },
    { header: 'Km recorridos',       width: 14, formato: 'numero',  valor: (v) => v.km_recorridos ?? 0 },
    { header: 'Combustible',         width: 14, formato: 'moneda',  valor: (v) => v.combustible },
    { header: 'Mano de obra',        width: 14, formato: 'moneda',  valor: (v) => v.mano_obra },
    { header: 'Refacciones usadas',  width: 16, formato: 'moneda',  valor: (v) => v.refacciones },
    { header: 'Casetas',             width: 14, formato: 'moneda',  valor: (v) => v.casetas },
    { header: 'Total',               width: 14, formato: 'moneda',  valor: (v) => v.total },
    { header: 'Costo por km',        width: 13, formato: 'moneda',  valor: (v) => v.costo_por_km ?? 0 },
    { header: 'Litros',              width: 11, formato: 'litros', valor: (v) => v.litros },
    { header: 'km/L',                width: 10, formato: 'decimal', valor: (v) => v.rendimiento ?? 0 },
    { header: 'km/L del modelo',     width: 15, formato: 'decimal', valor: (v) => v.rendimiento_modelo ?? 0 },
    { header: 'Diferencia %',        width: 13, formato: 'porcentaje', valor: (v) => v.desviacion_pct ?? 0 },
    { header: 'Sobrecosto anual',    width: 16, formato: 'moneda',  valor: (v) => v.sobrecosto_anual ?? 0 },
    { header: 'Mantenimientos',      width: 15, formato: 'numero',  valor: (v) => v.mantenimientos },
    { header: 'Cargas',              width: 10, formato: 'numero',  valor: (v) => v.recargas },
  ], a.vehiculos, { vacio: 'Sin movimiento registrado en el periodo.' })

  wb.hoja('Retrabajos', [
    { header: 'Vehículo',       width: 34, valor: (r) => r.vehiculo },
    { header: 'Servicio',       width: 22, valor: (r) => r.tipo },
    { header: 'Primera vez',    width: 14, formato: 'fecha',  valor: (r) => new Date(`${r.fecha_previa}T12:00:00`) },
    { header: 'Se repitió',     width: 14, formato: 'fecha',  valor: (r) => new Date(`${r.fecha}T12:00:00`) },
    { header: 'Días',           width: 8,  formato: 'numero', valor: (r) => r.dias },
    { header: 'Costo repetido', width: 16, formato: 'moneda', valor: (r) => r.costo },
  ], a.retrabajos, {
    totales: {
      'Vehículo': 'Total',
      'Costo repetido': a.retrabajos.reduce((s, r) => s + r.costo, 0),
    },
    vacio: 'Ningún servicio se repitió en menos de 30 días.',
  })

  wb.hoja('Cargas a revisar', [
    { header: 'Tipo',      width: 24, valor: (an) => ANOMALIA_LABEL[an.tipo] },
    { header: 'Severidad', width: 11, valor: (an) => an.severidad },
    { header: 'Vehículo',  width: 34, valor: (an) => an.vehiculo },
    { header: 'Fecha',     width: 13, formato: 'fecha',  valor: (an) => new Date(`${an.fecha}T12:00:00`) },
    { header: 'Detalle',   width: 62, valor: (an) => an.detalle },
    { header: 'Importe',   width: 14, formato: 'moneda', valor: (an) => an.monto ?? 0 },
  ], a.anomalias, { vacio: 'Ninguna carga del periodo levanta bandera.' })

  await wb.guardar(nombreBase(a))
}
