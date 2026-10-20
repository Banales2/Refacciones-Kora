// El PDF del historial de un tag en una caseta: la evidencia para PASE.
//
// No es "confía en mí": cada renglón trae el folio de la factura de PASE y la
// partida donde ellos mismos lo cobraron. Arriba, cuánto pagó cada importe y
// entre qué fechas, y si los demás tags pagaron lo mismo. Eso separa las dos
// cosas que se le reclaman distinto:
//
//   un aumento        todos los tags pasan de un importe a otro desde una fecha
//   un cobro raro     solo este tag, una vez, un importe que nadie más paga
import type { HistorialEnCaseta } from '../hooks/useFacturasCasetas'
import { formatFecha, formatMXN } from './formato'
import { COLOR, crearReportePdf, hoyISO } from './reportes/pdfDoc'

function fecha(fh: string): string {
  return formatFecha(fh.slice(0, 10))
}

function folio(p: { serie: string | null; folio: string }): string {
  return p.serie ? `${p.serie}-${p.folio}` : p.folio
}

export async function exportHistorialCasetaToPdf(
  h: HistorialEnCaseta, resaltar: { factura_id: number; renglon: number } | null,
) {
  const caseta = (h.nombre ?? `Caseta ${h.caseta}`).replace(/^PEAJE /i, '')
  const pdf = await crearReportePdf({
    titulo: `Historial en ${caseta}`,
    subtitulo: `Tag ${h.tag}${h.vehiculo ? ` · ${h.vehiculo}` : ''}`,
    orientacion: 'landscape',
  })

  const cobros = h.pasos.filter((p) => !p.ajuste)
  pdf.datos([
    ['Tag', h.tag],
    ['Unidad', h.vehiculo ?? 'Sin unidad'],
    ['Caseta', `${caseta} (${h.caseta})`],
    ['Cruces', `${cobros.length}, del ${fecha(cobros[0]?.fecha_hora ?? h.pasos[0].fecha_hora)} ` +
      `al ${fecha(cobros[cobros.length - 1]?.fecha_hora ?? h.pasos[h.pasos.length - 1].fecha_hora)}`],
  ])

  pdf.seccion(
    'Lo que ha pagado en esta caseta',
    'Cada importe con las fechas en que se cobró. "Otros tags" es lo que pagaron las demás unidades ' +
    'ahí con el mismo importe: si todas pasan a un importe nuevo desde una fecha, fue un aumento; si ' +
    'solo este tag lo pagó, es un cobro que hay que explicar.',
  )
  pdf.tabla({
    head: ['Importe', 'Clase', 'Veces', 'Primera', 'Última', 'Tarifa', 'Otros tags'],
    body: h.importes.map((i) => [
      formatMXN(i.total),
      i.clases.join(', '),
      i.cruces,
      fecha(i.primera),
      fecha(i.ultima),
      i.tramos.length > 0 ? i.tramos.join(' / ') : h.con_tarifa ? 'Fuera de tarifa' : 'Sin tarifa cargada',
      i.otros
        ? `${i.otros.cruces} cruces de ${i.otros.tags} tag(s), ${fecha(i.otros.primera)} – ${fecha(i.otros.ultima)}`
        : 'Ninguno',
    ]),
    columnStyles: {
      0: { halign: 'right', fontStyle: 'bold' },
      1: { halign: 'center' },
      2: { halign: 'center' },
    },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 5 && d.cell.raw === 'Fuera de tarifa') {
        d.cell.styles.textColor = COLOR.rojo
      }
    },
  })

  pdf.seccion('Cruce por cruce', 'Tal como viene en las facturas de PASE, del más viejo al más nuevo.')
  let anterior: number | null = null
  const filas = h.pasos.map((p) => {
    const cambio = !p.ajuste && anterior !== null && Math.abs(p.total - anterior) > 0.005
      ? `${p.total > anterior ? '+' : '−'}${formatMXN(Math.abs(p.total - anterior))}`
      : ''
    if (!p.ajuste) anterior = p.total
    return [
      `${fecha(p.fecha_hora)} ${p.fecha_hora.slice(11, 16)}`,
      folio(p),
      p.renglon,
      p.ajuste ? 'Ajuste' : p.clase,
      formatMXN(p.total),
      cambio,
      p.ajuste ? '—' : p.tramos.length > 0 ? p.tramos.join(' / ') + (p.ejes ? ` · ${p.ejes}` : '')
        : h.con_tarifa ? 'Fuera de tarifa' : 'Sin tarifa',
    ]
  })
  const marcada = resaltar
    ? h.pasos.findIndex((p) => p.factura_id === resaltar.factura_id && p.renglon === resaltar.renglon)
    : -1
  pdf.tabla({
    head: ['Fecha', 'Factura', 'Partida', 'Clase', 'Importe', 'Cambio', 'Tarifa'],
    body: filas,
    columnStyles: {
      2: { halign: 'center' },
      3: { halign: 'center' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
    didParseCell: (d) => {
      if (d.section !== 'body') return
      if (d.row.index === marcada) d.cell.styles.fontStyle = 'bold'
      if (d.row.index === marcada) d.cell.styles.textColor = COLOR.rojo
      if (d.column.index === 6 && d.cell.raw === 'Fuera de tarifa') d.cell.styles.textColor = COLOR.rojo
    },
    fontSize: 7,
  })

  pdf.nota(
    'Fuente: los CFDI de PASE importados al sistema (folio y partida de cada cruce). Tarifa: la vigente ' +
    'el día del cruce, de la tabla publicada por el operador.' +
    (marcada >= 0 ? ' En negritas y rojo, el cruce que se reclama.' : ''),
  )
  pdf.guardar(`historial-${h.tag}-${h.caseta}-${hoyISO()}`)
}
