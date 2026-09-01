// Ficha completa de una unidad, en PDF y en Excel.
//
// Es el expediente que se entrega cuando alguien pregunta "¿cómo va esta
// unidad?" o "¿la reparamos o la damos de baja?". Antes lo único exportable era
// el inventario de toda la flota, donde cada unidad ocupa un renglón; aquí cabe
// todo lo que se sabe de ella.
//
// Lo que se agregó con los datos nuevos de combustible: consumo y rendimiento
// medidos de carga a carga, costo por kilómetro, y el desglose de en qué se le
// ha ido el dinero. Eso es lo que convierte la ficha en un argumento.
import type { VehiculoRow } from '../../hooks/useVehiculos'
import type { RequerimientoExclusivo } from '../../hooks/useRequerimientos'
import type { Mantenimiento } from '../../hooks/useMantenimientos'
import type { Incidencia } from '../../hooks/useIncidencias'
import type { PiezaDeVehiculo } from '../../hooks/usePiezasVehiculo'
import type { Recarga } from '../../hooks/useRecargas'
import type { GarantiaVehiculo } from '../../hooks/useGarantias'
import { textoCobertura, etiquetaGarantia } from '../../hooks/useGarantias'
import { resumenPrimerosServicios } from '../intervalos'
import { crearReportePdf, hoyISO, COLOR, type CellHookData } from './pdfDoc'
import { crearLibroExcel } from './excelDoc'
import { formatMXN, formatNum, formatLitros, formatFecha } from '../formato'
import { TIPO_LABELS } from '../tipoVehiculo'
import { SEVERIDAD_META } from '../incidenciaMeta'
import { type Periodo, etiquetaPeriodo, sufijoPeriodo } from './periodo'

export interface DatosVehiculo {
  vehiculo:       VehiculoRow
  requerimientos: RequerimientoExclusivo[]
  /** Ids ya clasificados por la pantalla, para no recalcular el vencimiento aquí. */
  overdueIds:     Set<number>
  warnIds:        Set<number>
  mantenimientos: Mantenimiento[]
  incidencias:    Incidencia[]
  piezas:         PiezaDeVehiculo[]
  recargas:       Recarga[]
  /** Con su vigencia ya calculada por la API; no se recalcula aquí. */
  garantias:      GarantiaVehiculo[]
  /**
   * Periodo que se pidió. Las listas ya llegan filtradas por él desde la
   * pantalla; aquí solo sirve para decirlo en la portada, que es lo que evita
   * que un expediente de un año se lea como si fuera toda la vida de la unidad.
   */
  periodo?:       Periodo
}

/** Salto de odómetro entre dos cargas que ya no es creíble: es captura errónea. */
const KM_ENTRE_CARGAS_MAX = 5_000

function etiqueta(v: VehiculoRow): string {
  return `${v.marca} ${v.modelo} — ${v.serie}`
}

function nombreBase(v: VehiculoRow, periodo?: Periodo): string {
  // La serie puede traer caracteres que no van en un nombre de archivo.
  const sufijo = periodo ? sufijoPeriodo(periodo) : ''
  return `vehiculo-${v.serie.replace(/[^\w-]+/g, '')}-${sufijo || hoyISO()}`
}

interface Consumo {
  litros:       number
  costo:        number
  /** Tramos completos entre dos cargas: lo único con lo que se mide km/L. */
  kmMedidos:    number
  litrosMedidos: number
  rendimiento:  number | null
  precioLitro:  number | null
  sinVale:      number
  sinOdometro:  number
}

// Rendimiento tanque a tanque: los kilómetros desde la carga anterior los pagó
// esta carga. Es el mismo criterio del análisis de costos de la flota, para que
// la ficha de la unidad y el tablero no digan cosas distintas.
function calcularConsumo(recargas: Recarga[]): Consumo {
  const orden = [...recargas].sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id
  )
  const c: Consumo = {
    litros: 0, costo: 0, kmMedidos: 0, litrosMedidos: 0,
    rendimiento: null, precioLitro: null, sinVale: 0, sinOdometro: 0,
  }
  let previa: Recarga | null = null
  for (const r of orden) {
    c.litros += r.litros
    c.costo  += r.costo
    if (r.vale_id == null) c.sinVale += 1
    if (r.kilometraje == null) c.sinOdometro += 1
    else if (previa?.kilometraje != null) {
      const delta = r.kilometraje - previa.kilometraje
      if (delta > 0 && delta <= KM_ENTRE_CARGAS_MAX && r.litros > 0) {
        c.kmMedidos    += delta
        c.litrosMedidos += r.litros
      }
    }
    previa = r
  }
  if (c.litrosMedidos > 0) c.rendimiento = c.kmMedidos / c.litrosMedidos
  if (c.litros > 0)        c.precioLitro = c.costo / c.litros
  return c
}

interface Resumen {
  consumo:       Consumo
  manoObra:      number
  piezas:        number
  costoTotal:    number
  kmRecorridos:  number | null
  costoPorKm:    number | null
  ultimoMtto:    string | null
}

function resumir(d: DatosVehiculo): Resumen {
  const consumo  = calcularConsumo(d.recargas)
  const manoObra = d.mantenimientos.reduce((s, m) => s + m.costo, 0)
  const piezas   = d.mantenimientos.reduce((s, m) => s + m.piezas_total, 0)
  const costoTotal = manoObra + piezas + consumo.costo

  // El recorrido histórico sale de todas las lecturas que hay del odómetro,
  // vengan de una carga o de un servicio: es el rango que cubre el expediente.
  const lecturas = [
    ...d.recargas.map((r) => r.kilometraje),
    ...d.mantenimientos.map((m) => m.km_actual),
  ].filter((k): k is number => k != null && k > 0)
  const kmRecorridos = lecturas.length >= 2
    ? Math.max(...lecturas) - Math.min(...lecturas)
    : null

  const fechas = d.mantenimientos.map((m) => m.fecha).filter((f): f is string => !!f).sort()

  return {
    consumo, manoObra, piezas, costoTotal, kmRecorridos,
    costoPorKm: kmRecorridos && kmRecorridos > 0 ? costoTotal / kmRecorridos : null,
    ultimoMtto: fechas.length ? fechas[fechas.length - 1] : null,
  }
}

function estadoRequerimiento(d: DatosVehiculo, r: RequerimientoExclusivo): string {
  // Un servicio que existía por una garantía ya vencida no está "al día": dejó
  // de pedirse. Va primero porque la pantalla tampoco lo cuenta como vencido.
  if (r.silenciado_por_garantia) return 'Sin garantía'
  if (d.overdueIds.has(r.id))    return 'VENCIDO'
  if (d.warnIds.has(r.id))       return 'Por vencer'
  return 'Al día'
}

/** "hasta el 14 mar 2027 o los 100,000 km". */
function limiteGarantia(g: GarantiaVehiculo): string {
  const partes: string[] = []
  if (g.estado.vence_el) partes.push(formatFecha(g.estado.vence_el))
  if (g.estado.vence_a_los_km != null) partes.push(`${formatNum(g.estado.vence_a_los_km)} km`)
  return partes.join(' o ') || '—'
}

function intervalo(r: RequerimientoExclusivo): string {
  const partes: string[] = []
  if (r.intervalo_km != null)    partes.push(`${formatNum(r.intervalo_km)} km`)
  if (r.intervalo_meses != null) partes.push(`${r.intervalo_meses} mes${r.intervalo_meses !== 1 ? 'es' : ''}`)
  const base = partes.join(' o ') || '—'
  // Sin esto el expediente diría "cada 15,000 km" de un servicio cuyo primero
  // caía a los 5,000: el intervalo de ciclo no es toda la regla.
  const primeros = resumenPrimerosServicios(r.intervalos_iniciales_km, r.intervalo_km)
  return primeros ? `${base} (${primeros})` : base
}

// ─── PDF ────────────────────────────────────────────────────────────────────

export async function exportVehiculoPdf(d: DatosVehiculo) {
  const v = d.vehiculo
  const r = resumir(d)

  const periodoTxt = etiquetaPeriodo(d.periodo ?? { modo: 'default' }, 'Historial completo')
  const pdf = await crearReportePdf({
    titulo: `Expediente de unidad — ${etiqueta(v)}`,
    subtitulo: `${TIPO_LABELS[v.tipo] ?? v.tipo}${v.placas ? ` · Placas ${v.placas}` : ''} · ${periodoTxt}`,
  })

  // ── Identificación ──
  pdf.seccion('Datos de la unidad')
  pdf.datos([
    ['Tipo',            TIPO_LABELS[v.tipo] ?? v.tipo],
    ['Marca y modelo',  `${v.marca} ${v.modelo}${v.modelo_anio ? ` (${v.modelo_anio})` : ''}`],
    ['Número de serie', v.serie],
    ['Placas',          v.placas ?? '—'],
    ['Estatus',         v.status ?? '—'],
    ['Kilometraje actual', v.kilometraje != null ? `${formatNum(v.kilometraje)} km` : '—'],
    ['Combustible',     v.combustible ?? '—'],
    ['Ubicación',       v.sucursal ?? v.ruta ?? v.ubicacion ?? '—'],
    ['Fecha de compra', v.fecha_compra ? formatFecha(v.fecha_compra) : '—'],
  ])

  // ── Documentos ──
  pdf.seccion('Documentos')
  const docs: [string, string][] = [
    ['Póliza de seguro', v.seguro_poliza
      ? `${v.seguro_poliza} — ${v.seguro_compania ?? '—'}${v.seguro_expiracion ? ` (vence ${formatFecha(v.seguro_expiracion)})` : ''}`
      : 'SIN SEGURO ASIGNADO'],
    ['Permiso de circulación', v.permiso_zona
      ? `${v.permiso_zona}${v.permiso_expiracion ? ` (vence ${formatFecha(v.permiso_expiracion)})` : ''}`
      : '—'],
    ['Tenencia', v.tenencia_expiracion ? `Vence ${formatFecha(v.tenencia_expiracion)}` : '—'],
  ]
  pdf.datos(docs)
  if (v.alertas.length > 0) {
    pdf.nota(
      'Documentos faltantes: ' +
      v.alertas.map((a) => (a === 'sin_seguro' ? 'no tiene seguro asignado' : 'no tiene tenencia registrada')).join('; ') + '.'
    )
  }

  // ── Costo de operación ──
  pdf.seccion(
    'Costo de operación acumulado',
    d.periodo && d.periodo.modo !== 'default'
      ? `Movimientos de esta unidad registrados en el periodo (${periodoTxt}). Lo anterior a esa ` +
        'fecha no entra en estas sumas.'
      : 'Todo lo registrado de esta unidad en el sistema, desde el primer movimiento capturado.',
  )
  pdf.datos([
    ['Mano de obra en mantenimientos', formatMXN(r.manoObra)],
    ['Refacciones consumidas',         formatMXN(r.piezas)],
    ['Combustible',                    formatMXN(r.consumo.costo)],
    ['Costo total de operación',       formatMXN(r.costoTotal)],
  ], { destacarUltimo: true })
  pdf.datos([
    ['Kilómetros recorridos (según odómetros capturados)', r.kmRecorridos != null ? `${formatNum(r.kmRecorridos)} km` : '—'],
    ['Costo por kilómetro', r.costoPorKm != null ? formatMXN(r.costoPorKm) : '—'],
    ['Mantenimientos realizados', String(d.mantenimientos.length)],
    ['Último mantenimiento', r.ultimoMtto ? formatFecha(r.ultimoMtto) : '—'],
  ])

  // ── Combustible ──
  pdf.seccion(
    'Consumo de combustible',
    'El rendimiento se mide de una carga a la siguiente: los kilómetros desde la carga anterior ' +
    'los pagó la carga actual. Solo entran los tramos con kilometraje capturado en ambas.',
  )
  if (d.recargas.length === 0) {
    pdf.vacio('Sin recargas registradas para esta unidad.')
  } else {
    pdf.datos([
      ['Cargas registradas',   String(d.recargas.length)],
      ['Litros cargados',      `${formatLitros(r.consumo.litros)} L`],
      ['Gasto en combustible', formatMXN(r.consumo.costo)],
      ['Precio promedio por litro', r.consumo.precioLitro != null ? `$${r.consumo.precioLitro.toFixed(2)}` : '—'],
      ['Rendimiento', r.consumo.rendimiento != null
        ? `${r.consumo.rendimiento.toFixed(2)} km/L (medido sobre ${formatNum(r.consumo.kmMedidos)} km)`
        : 'sin tramos medibles'],
    ])
    if (r.consumo.sinOdometro > 0 || r.consumo.sinVale > 0) {
      const avisos: string[] = []
      if (r.consumo.sinOdometro > 0) avisos.push(`${r.consumo.sinOdometro} carga(s) sin kilometraje capturado`)
      if (r.consumo.sinVale > 0)     avisos.push(`${r.consumo.sinVale} carga(s) sin vale`)
      pdf.nota(`Pendientes de captura: ${avisos.join(' y ')}.`)
    }
    // Las últimas 20: el histórico completo de una unidad vieja no cabe y lo que
    // se revisa es el comportamiento reciente.
    const recientes = [...d.recargas]
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
      .slice(0, 20)
    pdf.subseccion(`Últimas ${recientes.length} cargas`)
    pdf.tabla({
      head: ['Fecha', 'Gasolinera', 'Conductor', 'Vale', 'Litros', 'Costo', '$/L', 'Odómetro'],
      body: recientes.map((rc) => [
        formatFecha(rc.fecha), rc.gasolinera, rc.conductor, rc.vale_folio ?? 'sin vale',
        formatLitros(rc.litros), formatMXN(rc.costo),
        rc.litros > 0 ? `$${(rc.costo / rc.litros).toFixed(2)}` : '—',
        rc.kilometraje != null ? formatNum(rc.kilometraje) : '—',
      ]),
      columnStyles: {
        4: { halign: 'right' }, 5: { halign: 'right' },
        6: { halign: 'right' }, 7: { halign: 'right' },
      },
      didParseCell: (c: CellHookData) => {
        if (c.section === 'body' && c.column.index === 3 && String(c.cell.raw) === 'sin vale') {
          c.cell.styles.textColor = COLOR.naranja
        }
      },
      fontSize: 8,
    })
  }

  // ── Garantías ──
  // Van antes de los requerimientos porque son su explicación: varios de los
  // servicios de abajo existen para no perderlas, y cuando se acaban dejan de
  // pedirse. Sin esta sección, el renglón "Sin garantía" de la tabla siguiente
  // no se entiende.
  const vigentes = d.garantias.filter((g) => g.estado.vigente)
  pdf.seccion(
    'Garantías',
    d.garantias.length === 0
      ? undefined
      : vigentes.length > 0
        ? `${vigentes.length} de ${d.garantias.length} siguen vigentes.`
        : 'Ninguna sigue vigente: la unidad ya no tiene cobertura.',
  )
  if (d.garantias.length === 0) {
    pdf.vacio('Esta unidad no tiene garantías registradas.')
  } else {
    pdf.tabla({
      head: ['Garantía', 'Cobertura', 'Desde', 'Vence', 'Servicios', 'Estado'],
      body: [...d.garantias]
        // Las vigentes arriba: son las que todavía se pueden reclamar.
        .sort((a, b) => Number(b.estado.vigente) - Number(a.estado.vigente) ||
                        a.nombre.localeCompare(b.nombre, 'es-MX'))
        .map((g) => [
          g.folio ? `${g.nombre} (folio ${g.folio})` : g.nombre,
          textoCobertura(g),
          g.fecha_inicio ? formatFecha(g.fecha_inicio) : 'sin fecha',
          limiteGarantia(g),
          String(g.requerimientos),
          etiquetaGarantia(g).label.toUpperCase(),
        ]),
      columnStyles: { 4: { halign: 'center' } },
      didParseCell: (c: CellHookData) => {
        if (c.section !== 'body' || c.column.index !== 5) return
        const txt = String(c.cell.raw)
        if (txt === 'VIGENTE')          c.cell.styles.textColor = COLOR.verde
        else if (txt === 'POR VENCER') { c.cell.styles.textColor = COLOR.naranja; c.cell.styles.fontStyle = 'bold' }
        else                            c.cell.styles.textColor = COLOR.gris
      },
      fontSize: 9,
    })

    const canceladas = d.garantias.filter((g) => g.motivo_cancelacion)
    for (const g of canceladas) {
      pdf.nota(`${g.nombre}: cancelada${g.cancelada_en ? ` el ${formatFecha(g.cancelada_en)}` : ''} — ${g.motivo_cancelacion}.`)
    }
    const sinFecha = d.garantias.filter((g) => g.estado.faltan_datos.length > 0).length
    if (sinFecha > 0) {
      pdf.nota(
        `${sinFecha} garantía(s) no se pueden calcular por completo (falta la fecha de inicio o el ` +
        'odómetro de la unidad). Mientras tanto se tratan como vigentes.'
      )
    }
  }

  // ── Requerimientos ──
  const vencidos = d.requerimientos.filter((q) => d.overdueIds.has(q.id))
  const sinGarantia = d.requerimientos.filter((q) => q.silenciado_por_garantia).length
  pdf.seccion(
    'Requerimientos preventivos',
    [
      vencidos.length > 0
        ? `${vencidos.length} de ${d.requerimientos.length} están vencidos.`
        : 'Ninguno vencido.',
      sinGarantia > 0
        ? `${sinGarantia} dejaron de pedirse: existían por una garantía que ya se acabó ` +
          '(aparecen como "Sin garantía").'
        : '',
    ].filter(Boolean).join(' '),
  )
  if (d.requerimientos.length === 0) {
    pdf.vacio('Esta unidad no tiene requerimientos preventivos capturados.')
  } else {
    pdf.tabla({
      head: ['Requerimiento', 'Categoría', 'Intervalo', 'Estado'],
      body: [...d.requerimientos]
        // Lo vencido primero: es lo que se va a hacer. Lo que ya no se pide por
        // garantía vencida, hasta abajo: está de rastro, no de tarea.
        .sort((a, b) =>
          Number(a.silenciado_por_garantia) - Number(b.silenciado_por_garantia) ||
          Number(d.overdueIds.has(b.id)) - Number(d.overdueIds.has(a.id)))
        .map((q) => [q.nombre, q.categoria ?? '—', intervalo(q), estadoRequerimiento(d, q)]),
      didParseCell: (c: CellHookData) => {
        if (c.section !== 'body' || c.column.index !== 3) return
        if (String(c.cell.raw) === 'VENCIDO')          { c.cell.styles.textColor = COLOR.rojo; c.cell.styles.fontStyle = 'bold' }
        else if (String(c.cell.raw) === 'Por vencer')   c.cell.styles.textColor = COLOR.naranja
        else if (String(c.cell.raw) === 'Sin garantía') c.cell.styles.textColor = COLOR.gris
      },
      fontSize: 9,
    })
  }

  // ── Mantenimientos ──
  pdf.seccion('Historial de mantenimientos')
  if (d.mantenimientos.length === 0) {
    pdf.vacio('Sin mantenimientos registrados.')
  } else {
    pdf.tabla({
      head: ['Fecha', 'Tipo', 'Técnico', 'Odómetro', 'Mano de obra', 'Refacciones', 'Total', 'Observaciones'],
      body: [
        ...[...d.mantenimientos]
          .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))
          .map((m) => [
            m.fecha ? formatFecha(m.fecha) : '—',
            m.tipo ?? '—',
            m.tecnico ?? '—',
            m.km_actual ? `${formatNum(m.km_actual)} km` : '—',
            formatMXN(m.costo),
            formatMXN(m.piezas_total),
            formatMXN(m.costo + m.piezas_total),
            m.observaciones ?? '',
          ]),
        ['Total', '', '', '', formatMXN(r.manoObra), formatMXN(r.piezas), formatMXN(r.manoObra + r.piezas), ''],
      ],
      columnStyles: {
        3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' },
      },
      totalAlFinal: true,
      fontSize: 8,
    })
  }

  // ── Incidencias ──
  const abiertas = d.incidencias.filter((i) => i.status === 'activo')
  pdf.seccion(
    'Incidencias reportadas',
    abiertas.length > 0 ? `${abiertas.length} sigue${abiertas.length !== 1 ? 'n' : ''} sin atender.` : 'Ninguna abierta.',
  )
  if (d.incidencias.length === 0) {
    pdf.vacio('Sin incidencias reportadas.')
  } else {
    pdf.tabla({
      head: ['Fecha', 'Incidencia', 'Categoría', 'Severidad', 'Reportó', 'Estado'],
      body: [...d.incidencias]
        .sort((a, b) => b.fecha.localeCompare(a.fecha))
        .map((i) => [
          formatFecha(i.fecha), i.nombre, i.categoria ?? '—',
          SEVERIDAD_META[i.severidad].label, i.reportado_por,
          i.status === 'activo' ? 'SIN ATENDER' : i.status,
        ]),
      didParseCell: (c: CellHookData) => {
        if (c.section !== 'body') return
        if (c.column.index === 5 && String(c.cell.raw) === 'SIN ATENDER') {
          c.cell.styles.textColor = COLOR.rojo; c.cell.styles.fontStyle = 'bold'
        }
        if (c.column.index === 3 && String(c.cell.raw) === SEVERIDAD_META.grave.label) {
          c.cell.styles.textColor = COLOR.rojo
        }
      },
      fontSize: 8,
    })
  }

  // ── Refacciones montadas ──
  const sinAsignar = d.piezas.filter((p) => p.pieza_id == null).length
  pdf.seccion(
    'Refacciones montadas',
    sinAsignar > 0
      ? `${sinAsignar} de ${d.piezas.length} posiciones no tienen refacción capturada.`
      : 'Todas las posiciones tienen refacción asignada.',
  )
  if (d.piezas.length === 0) {
    pdf.vacio('El modelo de esta unidad no tiene tipos de refacción configurados.')
  } else {
    pdf.tabla({
      head: ['Tipo de refacción', 'Posición', 'Refacción', 'Descripción', 'Instalada', 'Km instalación'],
      body: d.piezas.map((p) => [
        p.tipo_nombre,
        p.etiqueta || '—',
        p.numero_serie ?? 'SIN ASIGNAR',
        p.descripcion ?? '—',
        p.fecha_instalacion ? formatFecha(p.fecha_instalacion) : '—',
        p.km_instalacion != null ? `${formatNum(p.km_instalacion)} km` : '—',
      ]),
      columnStyles: { 5: { halign: 'right' } },
      didParseCell: (c: CellHookData) => {
        if (c.section === 'body' && c.column.index === 2 && String(c.cell.raw) === 'SIN ASIGNAR') {
          c.cell.styles.textColor = COLOR.naranja
        }
      },
      fontSize: 8,
    })
  }

  pdf.guardar(nombreBase(v, d.periodo))
}

// ─── Excel ──────────────────────────────────────────────────────────────────

export async function exportVehiculoExcel(d: DatosVehiculo) {
  const v = d.vehiculo
  const r = resumir(d)
  const wb = await crearLibroExcel()

  wb.hojaResumen('Ficha', [
    ['Unidad', etiqueta(v)],
    // Va arriba de todo lo demás: sin esto, un expediente de un año se lee
    // como si fuera toda la vida de la unidad. Los índices de `moneda` de
    // abajo cuentan desde aquí, así que mueven junto con este renglón.
    ['Periodo', etiquetaPeriodo(d.periodo ?? { modo: 'default' }, 'Historial completo')],
    ['Tipo', TIPO_LABELS[v.tipo] ?? v.tipo],
    ['Marca y modelo', `${v.marca} ${v.modelo}${v.modelo_anio ? ` (${v.modelo_anio})` : ''}`],
    ['Número de serie', v.serie],
    ['Placas', v.placas ?? '—'],
    ['Estatus', v.status ?? '—'],
    ['Kilometraje actual', v.kilometraje ?? 0],
    ['Combustible', v.combustible ?? '—'],
    ['Ubicación', v.sucursal ?? v.ruta ?? v.ubicacion ?? '—'],
    ['Fecha de compra', v.fecha_compra ? formatFecha(v.fecha_compra) : '—'],
    ['Póliza de seguro', v.seguro_poliza ?? 'SIN SEGURO ASIGNADO'],
    ['Permiso de circulación', v.permiso_zona ?? '—'],
    ['Tenencia vence', v.tenencia_expiracion ? formatFecha(v.tenencia_expiracion) : '—'],
    ['', ''],
    ['COSTO DE OPERACIÓN ACUMULADO', ''],
    ['Mano de obra', r.manoObra],
    ['Refacciones consumidas', r.piezas],
    ['Combustible', r.consumo.costo],
    ['Costo total', r.costoTotal],
    ['Kilómetros recorridos', r.kmRecorridos ?? 0],
    ['Costo por kilómetro', r.costoPorKm ?? 0],
    ['', ''],
    ['COMBUSTIBLE', ''],
    ['Cargas registradas', d.recargas.length],
    ['Litros cargados', r.consumo.litros],
    ['Precio promedio por litro', r.consumo.precioLitro ?? 0],
    ['Rendimiento (km/L)', r.consumo.rendimiento ?? 0],
    ['Cargas sin kilometraje', r.consumo.sinOdometro],
    ['Cargas sin vale', r.consumo.sinVale],
  ], { moneda: [16, 17, 18, 19, 21, 26] })

  wb.hoja('Mantenimientos', [
    { header: 'Fecha',         width: 13, formato: 'fecha',
      valor: (m) => m.fecha ? new Date(`${m.fecha.split('T')[0]}T12:00:00`) : null },
    { header: 'Tipo',          width: 20, valor: (m) => m.tipo ?? '—' },
    { header: 'Técnico',       width: 24, valor: (m) => m.tecnico ?? '—' },
    { header: 'Odómetro',      width: 13, formato: 'numero', valor: (m) => m.km_actual },
    { header: 'Mano de obra',  width: 15, formato: 'moneda', valor: (m) => m.costo },
    { header: 'Refacciones',   width: 15, formato: 'moneda', valor: (m) => m.piezas_total },
    { header: 'Total',         width: 15, formato: 'moneda', valor: (m) => m.costo + m.piezas_total },
    { header: 'Observaciones', width: 50, valor: (m) => m.observaciones ?? '' },
  ], d.mantenimientos, {
    totales: {
      'Fecha': 'Total', 'Mano de obra': r.manoObra, 'Refacciones': r.piezas,
      'Total': r.manoObra + r.piezas,
    },
    vacio: 'Sin mantenimientos registrados.',
  })

  wb.hoja('Combustible', [
    { header: 'Fecha',      width: 13, formato: 'fecha',   valor: (rc) => new Date(`${rc.fecha.split('T')[0]}T12:00:00`) },
    { header: 'Gasolinera', width: 28, valor: (rc) => rc.gasolinera },
    { header: 'Ubicación',  width: 24, valor: (rc) => rc.ubicacion },
    { header: 'Conductor',  width: 26, valor: (rc) => rc.conductor },
    { header: 'Vale',       width: 16, valor: (rc) => rc.vale_folio ?? 'sin vale' },
    { header: 'Litros',     width: 11, formato: 'litros', valor: (rc) => rc.litros },
    { header: 'Costo',      width: 14, formato: 'moneda',  valor: (rc) => rc.costo },
    { header: 'Precio/litro', width: 13, formato: 'moneda', valor: (rc) => rc.litros > 0 ? rc.costo / rc.litros : 0 },
    { header: 'Odómetro',   width: 13, formato: 'numero',  valor: (rc) => rc.kilometraje ?? 0 },
  ], d.recargas, {
    totales: { 'Fecha': 'Total', 'Litros': r.consumo.litros, 'Costo': r.consumo.costo },
    vacio: 'Sin recargas registradas para esta unidad.',
  })

  wb.hoja('Requerimientos', [
    { header: 'Requerimiento', width: 40, valor: (q) => q.nombre },
    { header: 'Categoría',     width: 22, valor: (q) => q.categoria ?? '—' },
    { header: 'Intervalo',     width: 24, valor: (q) => intervalo(q) },
    { header: 'Estado',        width: 14, valor: (q) => estadoRequerimiento(d, q) },
    { header: 'Descripción',   width: 50, valor: (q) => q.descripcion ?? '' },
  ], d.requerimientos, { vacio: 'Esta unidad no tiene requerimientos preventivos capturados.' })

  wb.hoja('Incidencias', [
    { header: 'Fecha',      width: 13, formato: 'fecha', valor: (i) => new Date(`${i.fecha.split('T')[0]}T12:00:00`) },
    { header: 'Incidencia', width: 36, valor: (i) => i.nombre },
    { header: 'Categoría',  width: 22, valor: (i) => i.categoria ?? '—' },
    { header: 'Severidad',  width: 14, valor: (i) => SEVERIDAD_META[i.severidad].label },
    { header: 'Reportó',    width: 24, valor: (i) => i.reportado_por },
    { header: 'Ubicación',  width: 24, valor: (i) => i.ubicacion },
    { header: 'Estado',     width: 14, valor: (i) => i.status === 'activo' ? 'Sin atender' : i.status },
    { header: 'Descripción',width: 50, valor: (i) => i.descripcion ?? '' },
  ], d.incidencias, { vacio: 'Sin incidencias reportadas.' })

  wb.hoja('Refacciones montadas', [
    { header: 'Tipo de refacción', width: 28, valor: (p) => p.tipo_nombre },
    { header: 'Posición',          width: 16, valor: (p) => p.etiqueta || '—' },
    { header: 'Refacción',         width: 22, valor: (p) => p.numero_serie ?? 'SIN ASIGNAR' },
    { header: 'Descripción',       width: 40, valor: (p) => p.descripcion ?? '—' },
    { header: 'Instalada',         width: 13, formato: 'fecha',
      valor: (p) => p.fecha_instalacion ? new Date(`${p.fecha_instalacion.split('T')[0]}T12:00:00`) : null },
    { header: 'Km instalación',    width: 15, formato: 'numero', valor: (p) => p.km_instalacion ?? 0 },
    { header: 'Origen',            width: 12, valor: (p) => p.origen },
  ], d.piezas, { vacio: 'El modelo de esta unidad no tiene tipos de refacción configurados.' })

  await wb.guardar(nombreBase(v, d.periodo))
}
