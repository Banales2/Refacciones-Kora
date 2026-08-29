// Comparativa de proveedores de una sola refacción.
//
// La comparativa global (comparativaPrecios) contesta "¿dónde hay margen en el
// catálogo?". Ésta contesta la otra pregunta, la que se hace con la pieza ya
// abierta y el teléfono en la mano: "¿a quién le compro ésta?". Por eso cabe en
// una hoja y lleva las dos variables de la decisión juntas —lo que cuesta y en
// cuántos días llega—, porque el más barato no sirve si la unidad se queda
// parada esperándolo.
import type { ComparativaPieza } from '../../hooks/usePreciosProveedor'
import { crearReportePdf, hoyISO, COLOR, type CellHookData } from './pdfDoc'
import { formatMXN, formatFecha } from '../formato'

function nombreBase(serie: string): string {
  // El número de serie va en el nombre del archivo, pero puede traer barras o
  // espacios: se limpia para que el navegador no lo corte al guardar.
  const limpio = serie.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return `comparativa-${limpio || 'refaccion'}-${hoyISO()}`
}

/** "3 días", "Inmediata", "—". El plazo se lee igual en toda la app. */
export function textoEntrega(dias: number | null): string {
  if (dias == null) return '—'
  if (dias === 0) return 'Inmediata'
  return `${dias} día${dias !== 1 ? 's' : ''}`
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
    ['Proveedores que la cotizan', String(fila?.precios.length ?? 0)],
  ])

  if (!fila || fila.precios.length === 0) {
    pdf.seccion('Sin precios capturados')
    pdf.vacio(
      'Ningún proveedor tiene precio registrado para esta refacción. ' +
      'Captúralos en Proveedores → Registrar precio.'
    )
    pdf.guardar(nombreBase(pieza.numero_serie))
    return
  }

  // ── Lo que hay que decidir, arriba y en dos renglones ──
  pdf.seccion('Recomendación')
  const resumen: [string, string][] = [
    ['Precio más bajo', `${formatMXN(fila.mejor_precio)} — ${fila.mejor_proveedor}`],
  ]
  if (fila.mejor_entrega != null) {
    resumen.push([
      'Entrega más rápida',
      `${textoEntrega(fila.mejor_entrega)} — ${fila.mejor_entrega_proveedor}`,
    ])
  }
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
    'Precio y tiempo de entrega por proveedor',
    'Precio vigente de cada proveedor —el de su cotización más reciente—, del más barato al más caro. ' +
    '"Entrega" es en días naturales, tal como lo dijo el proveedor.',
  )
  pdf.tabla({
    head: ['Proveedor', 'Precio', 'vs más barato', 'Entrega', 'Cotizado el'],
    body: fila.precios.map((p, i) => [
      p.proveedor,
      formatMXN(p.precio),
      i === 0 ? 'el más barato' : `+${p.sobre_mejor.toFixed(1)}%`,
      textoEntrega(p.tiempo_entrega_dias),
      formatFecha(p.fecha),
    ]),
    columnStyles: {
      1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' },
    },
    didParseCell: (d: CellHookData) => {
      if (d.section !== 'body') return
      // El más barato en verde y el sobreprecio grande en rojo: son las dos
      // celdas que se buscan de un vistazo al comparar.
      if (d.column.index === 2) {
        const txt = String(d.cell.raw)
        if (txt === 'el más barato') {
          d.cell.styles.textColor = COLOR.verde
          d.cell.styles.fontStyle = 'bold'
        } else if (parseFloat(txt.replace(/[+%]/g, '')) >= 25) {
          d.cell.styles.textColor = COLOR.rojo
        }
      }
      // Igual con el plazo: quien entrega antes se marca, aunque no sea el
      // barato — es justo la disyuntiva que el documento tiene que mostrar.
      if (d.column.index === 3 && fila.mejor_entrega != null) {
        const dias = fila.precios[d.row.index]?.tiempo_entrega_dias
        if (dias != null && dias === fila.mejor_entrega) {
          d.cell.styles.textColor = COLOR.verde
          d.cell.styles.fontStyle = 'bold'
        }
      }
    },
    fontSize: 9,
  })

  const sinEntrega = fila.precios.filter((p) => p.tiempo_entrega_dias == null).length
  if (sinEntrega > 0) {
    pdf.nota(
      `${sinEntrega} de ${fila.precios.length} proveedores no tienen tiempo de entrega capturado: ` +
      'su renglón dice "—", que no significa que entreguen rápido.'
    )
  }

  pdf.guardar(nombreBase(pieza.numero_serie))
}
