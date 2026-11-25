// Word de evidencia de "Cargas que conviene revisar".
//
// Las fotos del odómetro llegan al grupo de WhatsApp y nadie las tiene en el
// sistema, así que este documento no las trae: deja el hueco para pegarlas a
// mano junto a lo que se capturó. Por cada carga marcada, la carga y la
// anterior de la misma unidad lado a lado —quién cargó, qué km dio, cuánto y
// a qué precio—, que es lo que se pone contra la foto para ver quién capturó mal.
//
// Una carga por página: dos fotos de celular no caben en media hoja.
//
// docx se importa dinámicamente: solo hace falta al exportar.
import type { Anomalia, AnomaliasCostos, CargaEvidencia } from '../../hooks/useDashboard'
import type { Paragraph as ParrafoDocx, Table as TablaDocx } from 'docx'
import { ANOMALIA_LABEL } from './costos'
import { formatFecha, formatLitros, formatMXN, formatNum } from '../formato'

/** Carta con márgenes de 2 cm: 21.59 cm − 4 cm de ancho útil, en twips. */
const ANCHO_UTIL = 9800
const ANCHO_CONCEPTO = 2000
const ANCHO_CARGA = (ANCHO_UTIL - ANCHO_CONCEPTO) / 2
/** Alto mínimo del hueco de la foto: 9 cm. Crece si la foto pegada es más alta. */
const ALTO_FOTO = 5100

function descargar(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function precioLitro(c: CargaEvidencia): string {
  return c.litros > 0 ? `$${(c.costo / c.litros).toFixed(2)}/L` : '—'
}

/** Las que se pueden documentar con fotos: las que son de una carga. */
export function anomaliasConCarga(anomalias: Anomalia[]): Anomalia[] {
  return anomalias.filter((a) => a.carga != null)
}

export async function exportEvidenciaWord(
  d: AnomaliasCostos,
  { tipoLabel }: { tipoLabel?: string } = {},
) {
  const {
    AlignmentType, BorderStyle, Document, HeadingLevel, HeightRule, Packer, PageBreak, Paragraph,
    ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType,
  } = await import('docx')

  const anomalias = anomaliasConCarga(d.anomalias)
  const ultimo = (() => {
    const f = new Date(`${d.rango.end}T12:00:00`)
    f.setDate(f.getDate() - 1)
    return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`
  })()

  const texto = (t: string, o: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}) =>
    new TextRun({ text: t, bold: o.bold, color: o.color, size: o.size, italics: o.italics })

  const celda = (
    contenido: ParrafoDocx[] | string,
    o: { ancho: number; encabezado?: boolean; gris?: boolean; centrado?: boolean } = { ancho: ANCHO_CARGA },
  ) => new TableCell({
    width: { size: o.ancho, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: o.encabezado ? { type: ShadingType.CLEAR, color: 'auto', fill: 'DCE6F1' }
      : o.gris ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' } : undefined,
    children: typeof contenido === 'string'
      ? [new Paragraph({
          alignment: o.centrado ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: [texto(contenido, { bold: o.encabezado })],
        })]
      : contenido,
  })

  const renglon = (concepto: string, anterior: string, actual: string, resaltar = false) => new TableRow({
    children: [
      celda(concepto, { ancho: ANCHO_CONCEPTO, gris: true }),
      celda(anterior, { ancho: ANCHO_CARGA }),
      celda([new Paragraph({ children: [texto(actual, { bold: resaltar })] })], { ancho: ANCHO_CARGA }),
    ],
  })

  const hueco = (leyenda: string) => celda([
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [texto(leyenda, { color: '999999', italics: true, size: 18 })],
    }),
  ], { ancho: ANCHO_CARGA })

  const bloque = (an: Anomalia, i: number): (ParrafoDocx | TablaDocx)[] => {
    const c = an.carga!
    const p = an.anterior
    const sinAnterior = 'Sin carga anterior en el periodo'
    const de = (f: (x: CargaEvidencia) => string) => (p ? f(p) : '—')
    const km = (x: CargaEvidencia) => (x.kilometraje != null ? `${formatNum(x.kilometraje)} km` : 'Sin capturar')
    const avance = p?.kilometraje != null && c.kilometraje != null
      ? `${formatNum(c.kilometraje - p.kilometraje)} km desde la anterior`
      : null

    const tabla = new Table({
      width: { size: ANCHO_UTIL, type: WidthType.DXA },
      columnWidths: [ANCHO_CONCEPTO, ANCHO_CARGA, ANCHO_CARGA],
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            celda('', { ancho: ANCHO_CONCEPTO, encabezado: true }),
            celda(p ? 'Carga anterior' : sinAnterior, { ancho: ANCHO_CARGA, encabezado: true, centrado: true }),
            celda('Carga a revisar', { ancho: ANCHO_CARGA, encabezado: true, centrado: true }),
          ],
        }),
        renglon('Fecha', de((x) => formatFecha(x.fecha)), formatFecha(c.fecha)),
        renglon('Chofer', de((x) => x.conductor), c.conductor, p != null && p.conductor !== c.conductor),
        renglon('Gasolinera', de((x) => x.gasolinera ?? 'Emergencia'), c.gasolinera ?? 'Emergencia'),
        renglon('Km registrado', de(km), avance ? `${km(c)} (${avance})` : km(c), true),
        renglon('Litros', de((x) => `${formatLitros(x.litros)} L`), `${formatLitros(c.litros)} L`),
        renglon('Costo', de((x) => `${formatMXN(x.costo)} (${precioLitro(x)})`), `${formatMXN(c.costo)} (${precioLitro(c)})`),
        new TableRow({
          height: { value: ALTO_FOTO, rule: HeightRule.ATLEAST },
          children: [
            celda('Foto del km', { ancho: ANCHO_CONCEPTO, gris: true }),
            p ? hueco('Pega aquí la foto del odómetro') : celda('—', { ancho: ANCHO_CARGA, centrado: true }),
            hueco('Pega aquí la foto del odómetro'),
          ],
        }),
      ],
    })

    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        pageBreakBefore: i > 0,
        children: [texto(`${i + 1}. ${ANOMALIA_LABEL[an.tipo]} — ${an.vehiculo}`)],
      }),
      new Paragraph({
        spacing: { after: 80 },
        children: [texto(`${an.sucursal} · ${formatFecha(an.fecha)} · Folio de recarga ${c.recarga_id}`, { color: '666666', size: 18 })],
      }),
      new Paragraph({ spacing: { after: 160 }, children: [texto(an.detalle)] }),
      tabla,
      new Paragraph({ spacing: { before: 240, after: 80 }, children: [texto('Observaciones:', { bold: true })] }),
      // Tres renglones con línea abajo para escribir a mano o en el archivo.
      ...[0, 1, 2].map(() => new Paragraph({
        spacing: { before: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF', space: 1 } },
        children: [],
      })),
    ]
  }

  const portada: ParrafoDocx[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [texto('Evidencia de cargas a revisar')] }),
    new Paragraph({
      spacing: { after: 120 },
      children: [texto(
        `${d.sucursal ?? 'Todas las sucursales'}${tipoLabel ? ` · ${tipoLabel}` : ''} · `
        + `${formatFecha(d.rango.start)} a ${formatFecha(ultimo)}`,
        { color: '666666' },
      )],
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [texto(
        `${anomalias.length} carga${anomalias.length !== 1 ? 's' : ''}. Cada una va con la carga anterior de la misma `
        + 'unidad para poner lo capturado contra la foto del odómetro. El chofer de la carga a revisar va en negritas '
        + 'cuando no es el mismo de la anterior.',
        { size: 20 },
      )],
    }),
  ]

  const cuerpo: (ParrafoDocx | TablaDocx)[] = anomalias.length === 0
    ? [new Paragraph({ children: [texto('Ninguna carga del periodo levanta bandera.')] })]
    : [new Paragraph({ children: [new PageBreak()] }), ...anomalias.flatMap(bloque)]

  const doc = new Document({
    creator: 'Refacciones Kora',
    title: 'Evidencia de cargas a revisar',
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
        },
      },
      children: [...portada, ...cuerpo],
    }],
  })

  const sufijo = (d.sucursal ?? 'todas')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  descargar(await Packer.toBlob(doc), `evidencia-cargas-${sufijo}-${d.rango.start}_${ultimo}.docx`)
}
