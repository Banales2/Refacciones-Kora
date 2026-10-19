// El PDF de los tags de PASE: de qué unidad es cada uno y lo que falta.
//
// "Lo que falta" son dos listas distintas y las dos van primero, porque son lo
// que alguien tiene que resolver con el papel en la mano:
//
//   tags sin unidad      PASE los cobra y nadie ha dicho de quién son; sus
//                        cruces no cuentan en el gasto de ninguna unidad
//   translado sin tag    los tractocamiones sin tag registrado. Son los que
//                        cruzan casetas por regla; una unidad de reparto o un
//                        utilitario con tag es la excepción, y que no lo tenga
//                        no es algo que falte
//
// Las placas no vienen con el tag: se cruzan con la flota por `vehiculo_id`.
import type { TagCaseta } from '../hooks/useFacturasCasetas'
import type { VehiculoRow } from '../hooks/useVehiculos'
import { formatFecha, formatMXN } from './formato'
import { COLOR, crearReportePdf, hoyISO } from './reportes/pdfDoc'
import { TIPO_LABELS } from './tipoVehiculo'

/** El orden de los tipos en la lista de tags con unidad. */
const TIPOS_CON_TAG = ['tractocamion', 'camion', 'utilitario']

function ordenTipo(tipo: string | null): number {
  const i = TIPOS_CON_TAG.indexOf(tipo ?? '')
  return i === -1 ? TIPOS_CON_TAG.length : i
}

function ultimo(fh: string | null): string {
  return fh ? formatFecha(fh.slice(0, 10)) : '—'
}

export async function exportTagsCasetasToPdf(tags: TagCaseta[], vehiculos: VehiculoRow[]) {
  const porId = new Map(vehiculos.map((v) => [v.id, v]))
  const conUnidad = tags
    .filter((t) => t.vehiculo_id !== null)
    .sort((a, b) => ordenTipo(a.tipo_vehiculo) - ordenTipo(b.tipo_vehiculo)
      || (a.vehiculo ?? '').localeCompare(b.vehiculo ?? '', 'es-MX'))
  const sinUnidad = tags
    .filter((t) => t.vehiculo_id === null)
    .sort((a, b) => b.total - a.total)
  const conTag = new Set(conUnidad.map((t) => t.vehiculo_id))
  const sinTag = vehiculos
    .filter((v) => v.tipo === 'tractocamion' && !conTag.has(v.id))
    .sort((a, b) => `${a.marca} ${a.modelo}`.localeCompare(`${b.marca} ${b.modelo}`, 'es-MX')
      || a.serie.localeCompare(b.serie, 'es-MX', { numeric: true }))

  const pdf = await crearReportePdf({
    titulo: 'Tags de casetas',
    subtitulo: `${tags.length} tags registrados`,
    orientacion: 'landscape',
  })

  pdf.datos([
    ['Tags con unidad', String(conUnidad.length)],
    ['Tags sin unidad', String(sinUnidad.length)],
    ['Unidades de translado sin tag', String(sinTag.length)],
  ])

  pdf.seccion(
    'Tags sin unidad',
    'PASE los cobra y nadie ha dicho de qué unidad son: sus cruces no cuentan en el gasto de ninguna. ' +
    'Los que más han costado, primero.',
  )
  if (sinUnidad.length === 0) {
    pdf.vacio('Todos los tags tienen unidad.')
  } else {
    pdf.tabla({
      head: ['Tag', 'Cruces', 'Total', 'Último cruce', 'Nota', 'Unidad (anotar)'],
      body: sinUnidad.map((t) => [
        t.tag, t.cruces, formatMXN(t.total), ultimo(t.ultimo_cruce), t.nota ?? '', '',
      ]),
      columnStyles: {
        0: { font: 'courier' },
        1: { halign: 'center' },
        2: { halign: 'right' },
        5: { cellWidth: 70 },
      },
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 0) d.cell.styles.textColor = COLOR.rojo
      },
    })
  }

  pdf.seccion(
    'Unidades de translado sin tag',
    'Los tractocamiones sin tag registrado: o les falta el tag o es uno de los de arriba.',
  )
  if (sinTag.length === 0) {
    pdf.vacio('Todas las unidades de translado tienen tag.')
  } else {
    pdf.tabla({
      head: ['Unidad', 'Serie', 'Placas', 'Estatus', 'Tag (anotar)'],
      body: sinTag.map((v) => [
        `${v.marca} ${v.modelo}`, v.serie, v.placas ?? '—', v.status ?? '—', '',
      ]),
      columnStyles: { 4: { cellWidth: 55 } },
    })
  }

  pdf.seccion('Tags con unidad')
  if (conUnidad.length === 0) {
    pdf.vacio('Ningún tag tiene unidad todavía.')
  } else {
    pdf.tabla({
      head: ['Tag', 'Tipo', 'Unidad', 'Placas', 'Cruces', 'Total', 'Último cruce'],
      body: conUnidad.map((t) => [
        t.tag,
        TIPO_LABELS[t.tipo_vehiculo ?? ''] ?? '—',
        t.vehiculo ?? '—',
        porId.get(t.vehiculo_id!)?.placas ?? '—',
        t.cruces,
        formatMXN(t.total),
        ultimo(t.ultimo_cruce),
      ]),
      columnStyles: {
        0: { font: 'courier' },
        4: { halign: 'center' },
        5: { halign: 'right' },
      },
    })
  }

  pdf.nota('Total y cruces: lo que suman todas las facturas de PASE importadas.')
  pdf.guardar(`tags-casetas-${hoyISO()}`)
}
