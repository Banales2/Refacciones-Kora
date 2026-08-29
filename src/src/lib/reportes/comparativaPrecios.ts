// Reporte comparativo de precios de refacciones.
//
// Es el documento con el que se va a negociar: cada refacción con lo que pide
// cada proveedor, ordenadas por dónde hay más margen. Dos lecturas distintas y
// las dos importan:
//
//  - **Entre proveedores**: la diferencia entre el más caro y el más barato es
//    lo que se puede pedir de descuento.
//  - **Contra lo que se pagó**: si la última compra salió más cara que la mejor
//    cotización vigente, ahí ya se está perdiendo dinero cada vez que se repone.
import type { ComparativaPrecios } from '../../hooks/usePreciosProveedor'
import { crearReportePdf, hoyISO, COLOR, type CellHookData } from './pdfDoc'
import { crearLibroExcel } from './excelDoc'
import { formatMXN, formatFecha } from '../formato'
import { textoEntrega } from './comparativaPieza'

function nombreBase(): string {
  return `comparativa-precios-${hoyISO()}`
}

export async function exportComparativaPreciosPdf(c: ComparativaPrecios) {
  const conAhorro = c.piezas.filter((p) => p.ahorro_unitario != null)
  const comparables = c.piezas.filter((p) => p.precios.length > 1)

  const pdf = await crearReportePdf({
    titulo: 'Comparativa de precios de refacciones',
    subtitulo:
      `${c.totales.refacciones} refacción${c.totales.refacciones !== 1 ? 'es' : ''} cotizada${c.totales.refacciones !== 1 ? 's' : ''} · ` +
      `${c.proveedores.length} proveedor${c.proveedores.length !== 1 ? 'es' : ''}`,
    orientacion: 'landscape',
  })

  if (c.piezas.length === 0) {
    pdf.seccion('Sin precios capturados')
    pdf.vacio('Todavía no hay precios de proveedor registrados. Captúralos en Proveedores → Precios.')
    pdf.guardar(nombreBase())
    return
  }

  pdf.seccion('Resumen')
  pdf.datos([
    ['Refacciones con al menos un precio', String(c.totales.refacciones)],
    ['Refacciones con dos o más proveedores (comparables)', String(c.totales.comparables)],
    ['Refacciones que hoy se compran más caro de lo necesario', String(conAhorro.length)],
    ['Ahorro por unidad si se cambiara de proveedor', formatMXN(c.totales.ahorro_unitario_total)],
  ], { destacarUltimo: true })
  pdf.nota(
    'El ahorro es por unidad, no por el volumen del periodo: multiplícalo por lo que se compre de ' +
    'cada refacción. Se compara la última compra real contra la cotización vigente más baja.'
  )

  // ── Lo accionable: donde ya se está pagando de más ──
  if (conAhorro.length > 0) {
    pdf.seccion(
      'Refacciones que conviene cambiar de proveedor',
      'La última compra salió más cara que la mejor cotización vigente. Ordenadas por el ahorro por unidad.',
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
    'y "entrega" en cuántos días surte ese proveedor.',
  )
  pdf.tabla({
    head: ['Refacción', 'Descripción', 'Tipo', 'Proveedor', 'Precio', 'Entrega', 'Cotizado', 'vs mejor'],
    body: c.piezas.flatMap((p) =>
      p.precios.map((pr, i) => [
        // El nombre solo en el primer renglón de cada refacción: así el bloque
        // se lee como un grupo y no como filas sueltas repetidas.
        i === 0 ? p.numero_serie : '',
        i === 0 ? p.descripcion  : '',
        i === 0 ? (p.tipo_pieza ?? '—') : '',
        pr.proveedor,
        formatMXN(pr.precio),
        textoEntrega(pr.tiempo_entrega_dias),
        formatFecha(pr.fecha),
        i === 0 ? 'el más barato' : `+${pr.sobre_mejor.toFixed(1)}%`,
      ])
    ),
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 7: { halign: 'right' } },
    didParseCell: (d: CellHookData) => {
      if (d.section !== 'body' || d.column.index !== 7) return
      const txt = String(d.cell.raw)
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
    ['Proveedores con precios capturados', c.proveedores.length],
    ['Ahorro por unidad si se cambiara de proveedor', c.totales.ahorro_unitario_total],
    ['', ''],
    ['Nota', 'El ahorro es por unidad: multiplícalo por el volumen que se compre de cada refacción. ' +
             'Se compara la última compra real contra la cotización vigente más baja.'],
  ], { moneda: [3] })

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
      // 0 y no null cuando el proveedor no la cotiza: Excel deja la celda vacía
      // con null, y una celda vacía se confunde con "precio no capturado
      // todavía" en una tabla donde eso es justo lo que se está revisando.
      valor: (p: typeof c.piezas[number]) =>
        p.precios.find((x) => x.proveedor_id === prov.id)?.precio ?? 0,
    })),
    { header: 'Mejor precio',    width: 14, formato: 'moneda' as const, valor: (p: typeof c.piezas[number]) => p.mejor_precio },
    { header: 'Más barato con',  width: 26, valor: (p: typeof c.piezas[number]) => p.mejor_proveedor },
    { header: 'Entrega + rápida (días)', width: 20,
      valor: (p: typeof c.piezas[number]) => p.mejor_entrega ?? '—' },
    { header: 'Entrega + rápida con',    width: 26,
      valor: (p: typeof c.piezas[number]) => p.mejor_entrega_proveedor ?? '—' },
    { header: 'Diferencia',      width: 14, formato: 'moneda' as const, valor: (p: typeof c.piezas[number]) => p.diferencia },
    { header: 'Diferencia %',    width: 13, formato: 'porcentaje' as const, valor: (p: typeof c.piezas[number]) => p.diferencia_pct },
    { header: 'Última compra',   width: 14, formato: 'fecha' as const,
      valor: (p: typeof c.piezas[number]) => p.ultima_compra ? new Date(`${p.ultima_compra}T12:00:00`) : null },
    { header: 'Se le compró a',  width: 26, valor: (p: typeof c.piezas[number]) => p.ultimo_proveedor ?? '—' },
    { header: 'Pagado',          width: 14, formato: 'moneda' as const, valor: (p: typeof c.piezas[number]) => p.ultimo_pagado ?? 0 },
    { header: 'Ahorro/unidad',   width: 14, formato: 'moneda' as const, valor: (p: typeof c.piezas[number]) => p.ahorro_unitario ?? 0 },
  ]
  wb.hoja('Comparativa', columnasPivote, c.piezas, {
    totales: { 'Refacción': 'Total', 'Ahorro/unidad': c.totales.ahorro_unitario_total },
    vacio: 'Todavía no hay precios de proveedor registrados.',
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
    { header: 'Precio',      width: 14, formato: 'moneda', valor: (x) => x.precio.precio },
    { header: 'Entrega (días)', width: 14, valor: (x) => x.precio.tiempo_entrega_dias ?? '—' },
    { header: 'Cotizado',    width: 13, formato: 'fecha',  valor: (x) => new Date(`${x.precio.fecha}T12:00:00`) },
    { header: 'vs mejor %',  width: 12, formato: 'porcentaje', valor: (x) => x.precio.sobre_mejor },
    { header: 'Es el más barato', width: 16, valor: (x) => x.precio.sobre_mejor === 0 ? 'Sí' : 'No' },
  ], largo, { vacio: 'Todavía no hay precios de proveedor registrados.' })

  await wb.guardar(nombreBase())
}
