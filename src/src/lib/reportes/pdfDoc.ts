// Andamio compartido de los reportes en PDF.
//
// Los tres exportadores que existían repetían lo mismo: crear el jsPDF, llevar
// la `y` a mano, calcular si cabía la siguiente tabla, y sacar el `finalY` de
// autoTable con un cast feo. Cada reporte nuevo copiaba ese bloque otra vez, y
// bastaba con que uno olvidara el `ensureSpace` para que un título quedara
// solo al pie de una página. Aquí vive una vez.
//
// jsPDF y autoTable se importan dinámicamente: pesan ~600 kB juntos y solo se
// necesitan cuando alguien pide un reporte.
import type { CellHookData, UserOptions } from 'jspdf-autotable'
import type jsPDFType from 'jspdf'

export type { CellHookData }

/** Colores de la paleta del reporte, en RGB para jsPDF. */
export const COLOR = {
  encabezado: [51, 51, 51]    as [number, number, number],
  rojo:       [200, 40, 40]   as [number, number, number],
  naranja:    [190, 130, 20]  as [number, number, number],
  verde:      [25, 135, 100]  as [number, number, number],
  gris:       [120, 120, 120] as [number, number, number],
}

export interface OpcionesReporte {
  titulo:       string
  subtitulo?:   string
  orientacion?: 'portrait' | 'landscape'
}

export interface OpcionesTabla {
  head:            string[]
  body:            (string | number)[][]
  columnStyles?:   UserOptions['columnStyles']
  didParseCell?:   (data: CellHookData) => void
  /** Última fila en negritas, para los totales. */
  totalAlFinal?:   boolean
  fontSize?:       number
}

export interface ReportePdf {
  /** Título de bloque. Se lleva consigo el salto de página si no cabe nada debajo. */
  seccion(titulo: string, descripcion?: string): void
  /** Subtítulo dentro de una sección (un grupo, una sucursal, un tipo). */
  subseccion(titulo: string): void
  /** Pares etiqueta–valor, uno por renglón. Para los totales de un periodo. */
  datos(pares: [string, string][], opciones?: { destacarUltimo?: boolean }): void
  parrafo(texto: string): void
  /** Renglón en gris chico: aclaraciones de cómo se calculó algo. */
  nota(texto: string): void
  tabla(opciones: OpcionesTabla): void
  /** Mensaje centrado de "aquí no hubo nada", para no dejar una sección muda. */
  vacio(texto: string): void
  espacio(mm?: number): void
  guardar(nombreArchivo: string): void
}

// Ancho útil de la página, ya descontados los márgenes.
const MARGEN = 14
const PIE    = 14

export async function crearReportePdf(opciones: OpcionesReporte): Promise<ReportePdf> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const doc: jsPDFType = new jsPDF({ orientation: opciones.orientacion ?? 'portrait' })
  const alto  = doc.internal.pageSize.getHeight()
  const ancho = doc.internal.pageSize.getWidth()
  let y = 16

  function espacioParaOSalto(necesario: number) {
    if (y + necesario > alto - PIE) { doc.addPage(); y = 16 }
  }

  // ── Portada del reporte ──
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(opciones.titulo, MARGEN, y)
  doc.setFont('helvetica', 'normal')
  y += 7
  doc.setFontSize(10)
  doc.setTextColor(...COLOR.gris)
  const generado = `Generado el ${new Date().toLocaleDateString('es-MX', {
    day: '2-digit', month: 'long', year: 'numeric',
  })}`
  doc.text(opciones.subtitulo ? `${opciones.subtitulo} · ${generado}` : generado, MARGEN, y)
  doc.setTextColor(0)
  y += 10

  const api: ReportePdf = {
    seccion(titulo, descripcion) {
      // 22 mm es lo que ocupa el título más el arranque de lo que venga abajo:
      // pedirlos juntos es lo que evita el título huérfano al pie de página.
      espacioParaOSalto(descripcion ? 28 : 22)
      doc.setFontSize(12.5)
      doc.setFont('helvetica', 'bold')
      doc.text(titulo, MARGEN, y)
      doc.setFont('helvetica', 'normal')
      y += descripcion ? 5 : 7
      if (descripcion) {
        doc.setFontSize(8.5)
        doc.setTextColor(...COLOR.gris)
        for (const linea of doc.splitTextToSize(descripcion, ancho - MARGEN * 2)) {
          doc.text(linea, MARGEN, y)
          y += 4
        }
        doc.setTextColor(0)
        y += 3
      }
    },

    subseccion(titulo) {
      espacioParaOSalto(16)
      doc.setFontSize(10.5)
      doc.setTextColor(80)
      doc.text(titulo, MARGEN, y)
      doc.setTextColor(0)
      y += 2
    },

    datos(pares, opts) {
      doc.setFontSize(10)
      pares.forEach(([etiqueta, valor], i) => {
        espacioParaOSalto(8)
        const ultimo = opts?.destacarUltimo && i === pares.length - 1
        if (ultimo) doc.setFont('helvetica', 'bold')
        doc.text(etiqueta, MARGEN, y)
        // El valor se alinea a la derecha para que la columna de cifras quede
        // pareja aunque las etiquetas midan distinto.
        doc.text(valor, ancho - MARGEN, y, { align: 'right' })
        if (ultimo) doc.setFont('helvetica', 'normal')
        y += 6
      })
      y += 2
    },

    parrafo(texto) {
      doc.setFontSize(10)
      for (const linea of doc.splitTextToSize(texto, ancho - MARGEN * 2)) {
        espacioParaOSalto(8)
        doc.text(linea, MARGEN, y)
        y += 5
      }
      y += 2
    },

    nota(texto) {
      doc.setFontSize(8.5)
      doc.setTextColor(...COLOR.gris)
      for (const linea of doc.splitTextToSize(texto, ancho - MARGEN * 2)) {
        espacioParaOSalto(6)
        doc.text(linea, MARGEN, y)
        y += 4
      }
      doc.setTextColor(0)
      y += 3
    },

    tabla({ head, body, columnStyles, didParseCell, totalAlFinal, fontSize = 8 }) {
      autoTable(doc, {
        startY: y,
        margin: { left: MARGEN, right: MARGEN },
        head: [head],
        body,
        headStyles: { fillColor: COLOR.encabezado, fontSize },
        styles: { fontSize },
        columnStyles,
        didParseCell: (data) => {
          if (totalAlFinal && data.section === 'body' && data.row.index === body.length - 1) {
            data.cell.styles.fontStyle = 'bold'
          }
          didParseCell?.(data)
        },
      })
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
    },

    vacio(texto) {
      espacioParaOSalto(12)
      doc.setFontSize(9.5)
      doc.setTextColor(...COLOR.gris)
      doc.text(texto, ancho / 2, y, { align: 'center' })
      doc.setTextColor(0)
      y += 10
    },

    espacio(mm = 4) { y += mm },

    guardar(nombreArchivo) {
      // La numeración se pone al final porque hasta aquí no se sabe cuántas
      // páginas salieron.
      const total = doc.getNumberOfPages()
      for (let p = 1; p <= total; p++) {
        doc.setPage(p)
        doc.setFontSize(8)
        doc.setTextColor(...COLOR.gris)
        doc.text(`Página ${p} de ${total}`, ancho - MARGEN, alto - 8, { align: 'right' })
        doc.text('Refacciones Kora', MARGEN, alto - 8)
        doc.setTextColor(0)
      }
      doc.save(nombreArchivo.endsWith('.pdf') ? nombreArchivo : `${nombreArchivo}.pdf`)
    },
  }

  return api
}

/** Fecha de hoy en ISO corto, para el nombre de archivo. */
export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10)
}
