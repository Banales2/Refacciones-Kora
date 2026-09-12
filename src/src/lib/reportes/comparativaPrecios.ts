// Reporte comparativo de precios de refacciones.
//
// Es el documento con el que se va a negociar: cada refacción con lo que cuesta
// con cada proveedor, ordenadas por dónde hay más margen. Dos lecturas
// distintas y las dos importan:
//
//  - **Entre proveedores**: la diferencia entre el más caro y el más barato es
//    lo que se puede pedir de descuento.
//  - **Contra lo que se pagó**: si la última compra salió más cara que lo mejor
//    que hoy se consigue, ahí ya se está perdiendo dinero cada vez que se repone.
//
// TODOS LOS PRECIOS VAN CON DESCUENTO APLICADO, y por eso cada uno lleva su
// origen. Una cotización es precio de lista —el descuento por volumen se pacta
// después— y una compra ya trae el de su factura; compararlos crudos le da la
// razón al proveedor que nunca cotiza. El supuesto que se usa para las
// cotizaciones viaja en `descuento_referencia` y se imprime, porque es un
// supuesto y quien lea la tabla tiene que poder discutirlo.
import type { ComparativaPrecios, PrecioDeProveedor } from '../../hooks/usePreciosProveedor'
import { crearReportePdf, hoyISO, COLOR, type CellHookData } from './pdfDoc'
import { crearLibroExcel } from './excelDoc'
import { formatMXN, formatFecha } from '../formato'

function nombreBase(): string {
  return `comparativa-precios-${hoyISO()}`
}

// Cómo se lee un precio en la tabla: de dónde salió y sobre qué se descontó.
//
// UNA COMPRA SIN DESCUENTO DECLARADO NO ES UNA COMPRA SIN DESCUENTO. Hoy los
// precios se capturan ya descontados y sin desglosar —así entró todo el
// histórico—, así que `descuento_pct` en NULL puede significar dos cosas que
// desde aquí no se distinguen: que no hubo descuento, o que ya venía aplicado.
// Decir "−0%" elegía una de las dos y casi siempre la equivocada; "sin
// desglose" dice lo único que de verdad se sabe. Cuando la captura pase a
// lista + descuento de factura, estas compras empezarán a caer en el primer
// caso solas. Ver `docs/comparacion-de-precios.md`.
function textoOrigen(p: PrecioDeProveedor): string {
  if (p.origen === 'cotizado') return `Cotizado (−${p.descuento_pct ?? 0}% est.)`
  return p.descuento_pct ? `Pagado (−${p.descuento_pct}%)` : 'Pagado (sin desglose)'
}

/** Cómo se llegó al precio con descuento, para la hoja larga de Excel. */
function textoDescuento(p: PrecioDeProveedor, ref: number): string {
  if (p.origen === 'cotizado') return `Estimado (${ref}%)`
  return p.descuento_pct ? 'Descuento de la factura' : 'Ya venía descontado, sin desglose'
}

/**
 * Cómo se movió el precio contra el registro anterior de ese mismo proveedor.
 *
 * Es la lectura que queda cuando el catálogo tiene un solo proveedor: no hay
 * columnas que comparar, y lo que se pregunta es si subió. Un guion largo no es
 * "no cambió" sino "no hay contra qué": la primera compra no se mueve respecto
 * de nada.
 */
function textoCambio(p: PrecioDeProveedor): string {
  if (p.cambio_pct == null) return p.origen === 'pagado' ? 'Primera compra' : 'Primera cotización'
  const signo = p.cambio_pct > 0 ? '+' : ''
  return `${signo}${p.cambio_pct.toFixed(1)}%` +
    (p.fecha_anterior ? ` vs. ${formatFecha(p.fecha_anterior)}` : '')
}

/** El de lista solo se enseña cuando se sabe: sin desglose, no hay tal número. */
function textoLista(p: PrecioDeProveedor): string {
  return p.descuento_pct ? formatMXN(p.precio_lista) : '—'
}

function notaDeBase(c: ComparativaPrecios): string {
  return (
    'Todos los precios van con descuento aplicado. Los de las compras llevan el ' +
    'de su factura; las cotizaciones se estiman con ' +
    `${c.descuento_referencia}% de descuento, que es el que se suele conseguir por volumen. ` +
    'La columna "origen" dice cuál es cuál. Una compra "sin desglose" es una que ' +
    'se capturó con el precio ya descontado: el número es el que se pagó, pero no ' +
    'se sabe de qué lista salió.'
  )
}

export async function exportComparativaPreciosPdf(c: ComparativaPrecios) {
  const conAhorro = c.piezas.filter((p) => p.ahorro_unitario != null)
  const comparables = c.piezas.filter((p) => p.precios.length > 1)

  const pdf = await crearReportePdf({
    titulo: 'Comparativa de precios de refacciones',
    subtitulo:
      `${c.totales.refacciones} refacción${c.totales.refacciones !== 1 ? 'es' : ''} con precio · ` +
      `${c.proveedores.length} proveedor${c.proveedores.length !== 1 ? 'es' : ''} · ` +
      `cotizaciones estimadas con ${c.descuento_referencia}% de descuento`,
    orientacion: 'landscape',
  })

  if (c.piezas.length === 0) {
    pdf.seccion('Sin precios')
    pdf.vacio('Todavía no hay cotizaciones capturadas ni compras registradas con ningún proveedor.')
    pdf.guardar(nombreBase())
    return
  }

  pdf.seccion('Resumen')
  pdf.datos([
    ['Refacciones con al menos un precio', String(c.totales.refacciones)],
    ['Refacciones con dos o más proveedores (comparables)', String(c.totales.comparables)],
    ['Refacciones que subieron de precio con su proveedor', String(c.totales.con_alza)],
    ['Refacciones que hoy se compran más caro de lo necesario', String(conAhorro.length)],
    ['Ahorro por unidad si se cambiara de proveedor', formatMXN(c.totales.ahorro_unitario_total)],
  ], { destacarUltimo: true })
  pdf.nota(
    'El ahorro es por unidad, no por el volumen del periodo: multiplícalo por lo que se compre de ' +
    'cada refacción. Se compara la última compra real contra el mejor precio disponible hoy. ' +
    notaDeBase(c)
  )

  // ── Lo accionable: donde ya se está pagando de más ──
  if (conAhorro.length > 0) {
    pdf.seccion(
      'Refacciones que conviene cambiar de proveedor',
      'La última compra salió más cara que el mejor precio disponible hoy. Ordenadas por el ahorro por unidad.',
    )
    pdf.tabla({
      head: ['Refacción', 'Descripción', 'Última compra', 'Se le compró a', 'Pagado', 'Mejor precio', 'Con quién', 'Ahorro/unidad'],
      body: conAhorro.map((p) => [
        p.numero_serie, p.descripcion,
        p.ultima_compra ? formatFecha(p.ultima_compra) : '—',
        p.ultimo_proveedor ?? '—',
        p.ultimo_pagado != null ? formatMXN(p.ultimo_pagado) : '—',
        formatMXN(p.mejor_precio), p.mejor_proveedor,
        formatMXN(p.ahorro_unitario!),
      ]),
      columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 7: { halign: 'right' } },
      didParseCell: (d: CellHookData) => {
        if (d.section === 'body' && d.column.index === 7) {
          d.cell.styles.textColor = COLOR.verde
          d.cell.styles.fontStyle = 'bold'
        }
      },
      fontSize: 8,
    })
  }

  // ── Cómo se movió el precio con cada proveedor ──
  // Va antes de la comparación entre proveedores a propósito: no necesita un
  // segundo proveedor para existir, así que es lo único que se puede leer
  // cuando al catálogo todavía le falta competencia.
  const conCambio = c.piezas
    .flatMap((p) => p.precios.map((pr) => ({ pieza: p, precio: pr })))
    .filter((x) => x.precio.cambio_pct != null)
    .sort((a, b) => b.precio.cambio_pct! - a.precio.cambio_pct!)

  pdf.seccion(
    'Cómo cambió el precio con cada proveedor',
    'Cada precio vigente contra el registro anterior del mismo proveedor —la compra o la ' +
    'cotización previa—, de la mayor subida a la mayor baja. No depende de que haya otro ' +
    'proveedor con quien comparar.',
  )
  if (conCambio.length === 0) {
    pdf.vacio('Ninguna refacción tiene todavía dos registros del mismo proveedor con los que medir un cambio.')
  } else {
    pdf.tabla({
      head: ['Refacción', 'Descripción', 'Proveedor', 'Registros', 'Antes', 'Fecha', 'Ahora', 'Fecha', 'Cambio', 'Desde el inicio'],
      body: conCambio.map((x) => [
        x.pieza.numero_serie, x.pieza.descripcion, x.precio.proveedor,
        String(x.precio.registros),
        formatMXN(x.precio.precio_anterior!),
        x.precio.fecha_anterior ? formatFecha(x.precio.fecha_anterior) : '—',
        formatMXN(x.precio.precio), formatFecha(x.precio.fecha),
        `${x.precio.cambio_pct! > 0 ? '+' : ''}${x.precio.cambio_pct!.toFixed(1)}%`,
        x.precio.cambio_total_pct != null
          ? `${x.precio.cambio_total_pct > 0 ? '+' : ''}${x.precio.cambio_total_pct.toFixed(1)}% desde ${formatFecha(x.precio.fecha_primera)}`
          : '—',
      ]),
      columnStyles: {
        3: { halign: 'center' }, 4: { halign: 'right' },
        6: { halign: 'right' },  8: { halign: 'right' },
      },
      // Subir es lo que cuesta dinero; bajar también se marca, porque es el
      // dato con el que se defiende un precio en la siguiente compra.
      didParseCell: (d: CellHookData) => {
        if (d.section !== 'body' || d.column.index !== 8) return
        const v = parseFloat(String(d.cell.raw).replace(/[+%]/g, ''))
        if (v > 0)      { d.cell.styles.textColor = COLOR.rojo; d.cell.styles.fontStyle = 'bold' }
        else if (v < 0)   d.cell.styles.textColor = COLOR.verde
      },
      fontSize: 8,
    })
  }

  // ── Margen entre proveedores ──
  pdf.seccion(
    'Diferencia entre proveedores',
    'Solo las refacciones que cotizan dos o más. La diferencia es el margen que hay para negociar.',
  )
  if (comparables.length === 0) {
    pdf.vacio('Ninguna refacción tiene precio de más de un proveedor: no hay nada que comparar todavía.')
  } else {
    pdf.tabla({
      head: ['Refacción', 'Descripción', 'Provs.', 'Más barato', 'Precio', 'Más caro', 'Precio', 'Diferencia', '%'],
      body: comparables.map((p) => [
        p.numero_serie, p.descripcion, String(p.precios.length),
        p.mejor_proveedor, formatMXN(p.mejor_precio),
        p.peor_proveedor,  formatMXN(p.peor_precio),
        formatMXN(p.diferencia), `${p.diferencia_pct.toFixed(1)}%`,
      ]),
      columnStyles: {
        2: { halign: 'center' }, 4: { halign: 'right' }, 6: { halign: 'right' },
        7: { halign: 'right' },  8: { halign: 'right' },
      },
      // Una diferencia grande entre proveedores es la señal de que vale la pena
      // sentarse a negociar esa pieza; se marca para que salte en la impresión.
      didParseCell: (d: CellHookData) => {
        if (d.section !== 'body' || d.column.index !== 8) return
        const pct = parseFloat(String(d.cell.raw).replace('%', ''))
        if (pct >= 25)      { d.cell.styles.textColor = COLOR.rojo; d.cell.styles.fontStyle = 'bold' }
        else if (pct >= 10)  d.cell.styles.textColor = COLOR.naranja
      },
      fontSize: 8,
    })
  }

  // ── Detalle: todos los precios de cada refacción ──
  pdf.seccion(
    'Detalle por refacción',
    'Todos los precios vigentes de cada refacción, del más barato al más caro. ' +
    'La columna "vs mejor" dice cuánto más caro es cada uno que el más económico, ' +
    '"origen" si el precio sale de una cotización o de lo que ya se le paga, ' +
    'y "cambio" cómo se movió respecto del registro anterior de ese mismo proveedor.',
  )
  pdf.tabla({
    head: ['Refacción', 'Descripción', 'Tipo', 'Proveedor', 'Precio', 'Origen', 'Lista', 'Fecha', 'Cambio', 'vs mejor'],
    body: c.piezas.flatMap((p) =>
      p.precios.map((pr, i) => [
        // El nombre solo en el primer renglón de cada refacción: así el bloque
        // se lee como un grupo y no como filas sueltas repetidas.
        i === 0 ? p.numero_serie : '',
        i === 0 ? p.descripcion  : '',
        i === 0 ? (p.tipo_pieza ?? '—') : '',
        pr.proveedor,
        formatMXN(pr.precio),
        textoOrigen(pr),
        textoLista(pr),
        formatFecha(pr.fecha),
        textoCambio(pr),
        i === 0 ? 'el más barato' : `+${pr.sobre_mejor.toFixed(1)}%`,
      ])
    ),
    columnStyles: {
      4: { halign: 'right' }, 6: { halign: 'right' }, 9: { halign: 'right' },
    },
    didParseCell: (d: CellHookData) => {
      if (d.section !== 'body') return
      const txt = String(d.cell.raw)
      if (d.column.index === 8) {
        if (txt.startsWith('+'))      d.cell.styles.textColor = COLOR.rojo
        else if (txt.startsWith('-')) d.cell.styles.textColor = COLOR.verde
        return
      }
      if (d.column.index !== 9) return
      if (txt === 'el más barato') d.cell.styles.textColor = COLOR.verde
      else if (parseFloat(txt.replace(/[+%]/g, '')) >= 25) d.cell.styles.textColor = COLOR.rojo
    },
    fontSize: 8,
  })

  pdf.guardar(nombreBase())
}

export async function exportComparativaPreciosExcel(c: ComparativaPrecios) {
  const wb = await crearLibroExcel()

  wb.hojaResumen('Resumen', [
    ['Refacciones con al menos un precio', c.totales.refacciones],
    ['Refacciones comparables (dos o más proveedores)', c.totales.comparables],
    ['Refacciones que subieron de precio con su proveedor', c.totales.con_alza],
    ['Proveedores con precio (cotizado o pagado)', c.proveedores.length],
    ['Descuento supuesto sobre las cotizaciones (%)', c.descuento_referencia],
    ['Ahorro por unidad si se cambiara de proveedor', c.totales.ahorro_unitario_total],
    ['', ''],
    ['Nota', 'El ahorro es por unidad: multiplícalo por el volumen que se compre de cada refacción. ' +
             'Se compara la última compra real contra el mejor precio disponible hoy.'],
    ['Base de comparación', notaDeBase(c)],
  ], { moneda: [4] })

  // ── Hoja pivote: una columna por proveedor ──
  // Es la vista que se pide en la junta de compras ("enséñame la tabla"), y en
  // Excel sí cabe a lo ancho aunque en el PDF no.
  const columnasPivote = [
    { header: 'Refacción',   width: 22, valor: (p: typeof c.piezas[number]) => p.numero_serie },
    { header: 'Descripción', width: 40, valor: (p: typeof c.piezas[number]) => p.descripcion },
    { header: 'Tipo',        width: 20, valor: (p: typeof c.piezas[number]) => p.tipo_pieza ?? '—' },
    ...c.proveedores.map((prov) => ({
      header: prov.nombre,
      width: 16,
      formato: 'moneda' as const,
      // 0 y no null cuando el proveedor no tiene precio: Excel deja la celda
      // vacía con null, y una celda vacía se confunde con "precio no capturado
      // todavía" en una tabla donde eso es justo lo que se está revisando.
      valor: (p: typeof c.piezas[number]) =>
        p.precios.find((x) => x.proveedor_id === prov.id)?.precio ?? 0,
    })),
    { header: 'Mejor precio',    width: 14, formato: 'moneda' as const, valor: (p: typeof c.piezas[number]) => p.mejor_precio },
    { header: 'Más barato con',  width: 26, valor: (p: typeof c.piezas[number]) => p.mejor_proveedor },
    { header: 'Origen del mejor', width: 16,
      valor: (p: typeof c.piezas[number]) => p.precios[0]?.origen === 'pagado' ? 'Pagado' : 'Cotizado' },
    { header: 'Diferencia',      width: 14, formato: 'moneda' as const, valor: (p: typeof c.piezas[number]) => p.diferencia },
    { header: 'Diferencia %',    width: 13, formato: 'porcentaje' as const, valor: (p: typeof c.piezas[number]) => p.diferencia_pct },
    { header: 'Última compra',   width: 14, formato: 'fecha' as const,
      valor: (p: typeof c.piezas[number]) => p.ultima_compra ? new Date(`${p.ultima_compra}T12:00:00`) : null },
    { header: 'Se le compró a',  width: 26, valor: (p: typeof c.piezas[number]) => p.ultimo_proveedor ?? '—' },
    { header: 'Pagado',          width: 14, formato: 'moneda' as const, valor: (p: typeof c.piezas[number]) => p.ultimo_pagado ?? 0 },
    { header: 'Ahorro/unidad',   width: 14, formato: 'moneda' as const, valor: (p: typeof c.piezas[number]) => p.ahorro_unitario ?? 0 },
    // La mayor subida entre sus proveedores. Es lo que ordena la tabla cuando
    // no hay con quién comparar, así que tiene que poder filtrarse en Excel.
    { header: 'Mayor alza %',    width: 13, formato: 'porcentaje' as const,
      valor: (p: typeof c.piezas[number]) => p.alza_pct ?? 0 },
  ]
  wb.hoja('Comparativa', columnasPivote, c.piezas, {
    totales: { 'Refacción': 'Total', 'Ahorro/unidad': c.totales.ahorro_unitario_total },
    vacio: 'Todavía no hay cotizaciones capturadas ni compras registradas.',
  })

  // ── Hoja larga: un renglón por (refacción, proveedor) ──
  // La pivote es para leer; ésta es para hacerle tabla dinámica encima.
  const largo = c.piezas.flatMap((p) =>
    p.precios.map((pr) => ({ pieza: p, precio: pr }))
  )
  wb.hoja('Precios', [
    { header: 'Refacción',   width: 22, valor: (x) => x.pieza.numero_serie },
    { header: 'Descripción', width: 40, valor: (x) => x.pieza.descripcion },
    { header: 'Tipo',        width: 20, valor: (x) => x.pieza.tipo_pieza ?? '—' },
    { header: 'Proveedor',   width: 28, valor: (x) => x.precio.proveedor },
    { header: 'Precio con descuento', width: 18, formato: 'moneda', valor: (x) => x.precio.precio },
    { header: 'Origen',      width: 12, valor: (x) => x.precio.origen === 'pagado' ? 'Pagado' : 'Cotizado' },
    { header: 'Precio de lista', width: 16, valor: (x) => textoLista(x.precio) },
    { header: 'Descuento %', width: 12, formato: 'porcentaje', valor: (x) => x.precio.descuento_pct ?? 0 },
    { header: 'Cómo se descontó', width: 30,
      valor: (x) => textoDescuento(x.precio, c.descuento_referencia) },
    { header: 'Fecha',       width: 13, formato: 'fecha',  valor: (x) => new Date(`${x.precio.fecha}T12:00:00`) },
    // La otra fuente del mismo proveedor: el contraste con el que se negocia
    // ("te pago esto y me cotizas esto otro").
    { header: 'También lo tiene como', width: 20,
      valor: (x) => x.precio.otro ? (x.precio.otro.origen === 'pagado' ? 'Pagado' : 'Cotizado') : '—' },
    { header: 'Precio de esa otra fuente', width: 22, formato: 'moneda',
      valor: (x) => x.precio.otro?.precio ?? 0 },
    { header: 'Registros de este proveedor', width: 24, valor: (x) => x.precio.registros },
    { header: 'Precio anterior', width: 16, formato: 'moneda', valor: (x) => x.precio.precio_anterior ?? 0 },
    { header: 'Fecha anterior',  width: 14, formato: 'fecha',
      valor: (x) => x.precio.fecha_anterior ? new Date(`${x.precio.fecha_anterior}T12:00:00`) : null },
    { header: 'Cambio %',        width: 12, formato: 'porcentaje', valor: (x) => x.precio.cambio_pct ?? 0 },
    { header: 'Primer precio',   width: 14, formato: 'moneda', valor: (x) => x.precio.precio_primero },
    { header: 'Desde',           width: 13, formato: 'fecha',
      valor: (x) => new Date(`${x.precio.fecha_primera}T12:00:00`) },
    { header: 'Cambio total %',  width: 14, formato: 'porcentaje', valor: (x) => x.precio.cambio_total_pct ?? 0 },
    { header: 'vs mejor %',  width: 12, formato: 'porcentaje', valor: (x) => x.precio.sobre_mejor },
    { header: 'Es el más barato', width: 16, valor: (x) => x.precio.sobre_mejor === 0 ? 'Sí' : 'No' },
  ], largo, { vacio: 'Todavía no hay cotizaciones capturadas ni compras registradas.' })

  await wb.guardar(nombreBase())
}
