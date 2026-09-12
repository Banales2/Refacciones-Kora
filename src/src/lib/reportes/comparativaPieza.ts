// Comparativa de proveedores de una sola refacción.
//
// La comparativa global (comparativaPrecios) contesta "¿dónde hay margen en el
// catálogo?". Ésta contesta la otra pregunta, la que se hace con la pieza ya
// abierta y el teléfono en la mano: "¿a quién le compro ésta?". Por eso cabe en
// una hoja y lleva lo que cuesta hoy con cada proveedor y cómo llegó a costar
// eso: cuando hay un solo proveedor no hay columnas que comparar, y el único
// argumento que queda para la llamada es su propio historial.
import type { ComparativaPieza } from '../../hooks/usePreciosProveedor'
import { crearReportePdf, hoyISO, COLOR, type CellHookData } from './pdfDoc'
import { formatMXN, formatFecha } from '../formato'
import { conVariacion } from '../historialPrecios'

function nombreBase(serie: string): string {
  // El número de serie va en el nombre del archivo, pero puede traer barras o
  // espacios: se limpia para que el navegador no lo corte al guardar.
  const limpio = serie.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return `comparativa-${limpio || 'refaccion'}-${hoyISO()}`
}

export async function exportComparativaPiezaPdf(c: ComparativaPieza) {
  const { pieza, fila } = c

  const pdf = await crearReportePdf({
    titulo: 'Comparativa de proveedores',
    subtitulo: `${pieza.numero_serie} · ${pieza.descripcion}`,
  })

  pdf.seccion('Refacción')
  pdf.datos([
    ['Número de serie', pieza.numero_serie],
    ['Descripción',     pieza.descripcion],
    ['Tipo',            pieza.tipo_pieza ?? 'Sin tipo'],
    ['Proveedores con precio', String(fila?.precios.length ?? 0)],
  ])

  if (!fila || fila.precios.length === 0) {
    pdf.seccion('Sin precios')
    pdf.vacio(
      'Ningún proveedor cotiza esta refacción y nunca se le ha comprado a nadie. ' +
      'Captura un precio en Proveedores → Registrar precio.'
    )
    pdf.guardar(nombreBase(pieza.numero_serie))
    return
  }

  // ── Lo que hay que decidir, arriba y en dos renglones ──
  pdf.seccion('Recomendación')
  const resumen: [string, string][] = [
    ['Precio más bajo', `${formatMXN(fila.mejor_precio)} — ${fila.mejor_proveedor}`],
  ]
  if (fila.precios.length > 1) {
    resumen.push([
      'Margen entre el más caro y el más barato',
      `${formatMXN(fila.diferencia)} (${fila.diferencia_pct.toFixed(1)}%)`,
    ])
  }
  if (fila.ultimo_pagado != null) {
    resumen.push([
      'Última compra',
      `${formatMXN(fila.ultimo_pagado)} — ${fila.ultimo_proveedor ?? '—'}` +
      (fila.ultima_compra ? ` (${formatFecha(fila.ultima_compra)})` : ''),
    ])
  }
  if (fila.ahorro_unitario != null) {
    resumen.push(['Ahorro por unidad si se cambia de proveedor', formatMXN(fila.ahorro_unitario)])
  }
  pdf.datos(resumen, { destacarUltimo: fila.ahorro_unitario != null })

  // ── La tabla que se lleva a la llamada ──
  pdf.seccion(
    'Precio por proveedor',
    'Lo que cuesta con cada proveedor, del más barato al más caro, siempre CON descuento: ' +
    'el de la factura cuando el precio sale de una compra, y el estimado ' +
    `de ${c.descuento_referencia}% cuando sale de una cotización —que es como las mandan, a lista—. ` +
    '"Cómo cambió" compara contra el registro anterior de ese mismo proveedor.',
  )
  pdf.tabla({
    head: ['Proveedor', 'Precio', 'Origen', 'Lista', 'vs más barato', 'Fecha', 'Cómo cambió'],
    body: fila.precios.map((p, i) => [
      p.proveedor,
      formatMXN(p.precio),
      // Una compra sin descuento declarado no es una compra sin descuento: hoy
      // los precios se capturan ya descontados y sin desglosar, así que "−0%"
      // afirmaría algo que no se sabe. Ver `docs/comparacion-de-precios.md`.
      p.origen === 'pagado'
        ? (p.descuento_pct ? `Pagado (−${p.descuento_pct}%)` : 'Pagado (sin desglose)')
        : `Cotizado (−${p.descuento_pct ?? 0}% est.)`,
      p.descuento_pct ? formatMXN(p.precio_lista) : '—',
      i === 0 ? 'el más barato' : `+${p.sobre_mejor.toFixed(1)}%`,
      formatFecha(p.fecha),
      // Contra el registro anterior de ESE proveedor. Es lo que se lleva a la
      // llamada cuando hay uno solo: no se puede decir "me lo dan más barato
      // allá", pero sí "me lo subiste 9% en tres meses".
      p.cambio_pct == null
        ? (p.origen === 'pagado' ? 'Primera compra' : 'Primera cotización')
        : `${p.cambio_pct > 0 ? '+' : ''}${p.cambio_pct.toFixed(1)}%` +
          (p.fecha_anterior ? ` vs. ${formatFecha(p.fecha_anterior)}` : ''),
    ]),
    columnStyles: {
      1: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
    },
    didParseCell: (d: CellHookData) => {
      if (d.section !== 'body') return
      // El más barato en verde y el sobreprecio grande en rojo: son las dos
      // celdas que se buscan de un vistazo al comparar.
      if (d.column.index === 4) {
        const txt = String(d.cell.raw)
        if (txt === 'el más barato') {
          d.cell.styles.textColor = COLOR.verde
          d.cell.styles.fontStyle = 'bold'
        } else if (parseFloat(txt.replace(/[+%]/g, '')) >= 25) {
          d.cell.styles.textColor = COLOR.rojo
        }
      }
      // Subir cuesta dinero; bajar es el argumento con el que se sostiene el
      // precio en la siguiente compra. Los dos se marcan.
      if (d.column.index === 6) {
        const txt = String(d.cell.raw)
        if (txt.startsWith('+'))      d.cell.styles.textColor = COLOR.rojo
        else if (txt.startsWith('-')) d.cell.styles.textColor = COLOR.verde
      }
    },
    fontSize: 9,
  })

  // ── El flujo del costo ──
  // La misma tabla que la pantalla, con la misma función compartida: es lo que
  // impide que la hoja y el modal cuenten historias distintas.
  const registros = conVariacion(c.historial)
  pdf.seccion(
    'Cómo ha ido el costo',
    'Cada compra y cada cotización, de la más reciente a la más vieja. El cambio es contra la ' +
    'vez anterior del MISMO proveedor: entre dos proveedores distintos la diferencia es de ' +
    'precio, no un cambio. Una compra es una factura, así que las partidas repetidas del mismo ' +
    'papel cuentan como un solo movimiento y sus piezas se suman.',
  )
  if (registros.length === 0) {
    pdf.vacio('No hay ninguna compra ni cotización registrada de esta refacción.')
  } else {
    pdf.tabla({
      head: ['Fecha', 'Proveedor', 'Origen', 'Costo', 'Cambio', 'Factura', 'Piezas'],
      body: registros.map((r) => [
        formatFecha(r.fecha), r.proveedor,
        r.origen === 'pagado' ? 'Pagado' : 'Cotizado',
        formatMXN(r.precio),
        r.cambio_pct == null
          ? 'primera vez'
          : `${r.cambio_pct > 0 ? '+' : ''}${r.cambio_pct.toFixed(1)}%`,
        r.folio ?? '—',
        r.cantidad == null ? '—' : String(r.cantidad),
      ]),
      columnStyles: {
        3: { halign: 'right' }, 4: { halign: 'right' }, 6: { halign: 'center' },
      },
      didParseCell: (d: CellHookData) => {
        if (d.section !== 'body' || d.column.index !== 4) return
        const txt = String(d.cell.raw)
        if (txt.startsWith('+'))      d.cell.styles.textColor = COLOR.rojo
        else if (txt.startsWith('-')) d.cell.styles.textColor = COLOR.verde
      },
      fontSize: 9,
    })
  }

  pdf.guardar(nombreBase(pieza.numero_serie))
}
