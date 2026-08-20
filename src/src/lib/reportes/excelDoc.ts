// Andamio compartido de los reportes en Excel.
//
// Mismo motivo que el de PDF: cada exportador repetía el ancho de columnas, el
// negritas en la fila 1, el formato de moneda columna por columna y el truco
// del <a download> para bajar el blob. Aquí se declara la hoja y ya.
//
// exceljs se importa dinámicamente: pesa ~900 kB y solo hace falta al exportar.

export type FormatoColumna = 'texto' | 'moneda' | 'numero' | 'decimal' | 'litros' | 'fecha' | 'porcentaje'

export interface Columna<T> {
  header:   string
  width?:   number
  formato?: FormatoColumna
  valor:    (fila: T) => string | number | Date | null
}

const NUM_FMT: Record<FormatoColumna, string | undefined> = {
  texto:      undefined,
  moneda:     '"$"#,##0.00',
  numero:     '#,##0',
  decimal:    '#,##0.00',
  // Dos decimales siempre y el tercero solo si lo hay: la bomba despacha en
  // milésimas, pero las cargas redondas no se ven con un cero de sobra.
  litros:     '#,##0.00#',
  fecha:      'dd/mm/yyyy',
  porcentaje: '0.0"%"',
}

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

export interface LibroExcel {
  /**
   * Agrega una hoja tabular. `totales` es una fila extra en negritas al final,
   * indexada por el header de la columna donde va cada valor.
   */
  hoja<T>(
    nombre: string,
    columnas: Columna<T>[],
    filas: T[],
    opciones?: { totales?: Record<string, string | number>; vacio?: string },
  ): void
  /** Hoja de dos columnas concepto–valor, para los totales de un periodo. */
  hojaResumen(nombre: string, pares: [string, string | number][], opciones?: { moneda?: number[] }): void
  guardar(nombreArchivo: string): Promise<void>
}

export async function crearLibroExcel(): Promise<LibroExcel> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Refacciones Kora'
  wb.created = new Date()

  return {
    hoja(nombre, columnas, filas, opciones) {
      // Excel no acepta : \ / ? * [ ] en el nombre de hoja, ni más de 31 chars.
      const ws = wb.addWorksheet(nombre.replace(/[:\\/?*[\]]/g, '-').slice(0, 31))
      ws.columns = columnas.map((c, i) => ({
        header: c.header,
        key:    `c${i}`,
        width:  c.width ?? Math.max(12, Math.min(42, c.header.length + 6)),
      }))
      ws.getRow(1).font = { bold: true }
      ws.views = [{ state: 'frozen', ySplit: 1 }]

      for (const fila of filas) {
        const valores: Record<string, string | number | Date | null> = {}
        columnas.forEach((c, i) => { valores[`c${i}`] = c.valor(fila) })
        ws.addRow(valores)
      }

      columnas.forEach((c, i) => {
        const fmt = NUM_FMT[c.formato ?? 'texto']
        if (fmt) ws.getColumn(`c${i}`).numFmt = fmt
      })

      if (filas.length === 0 && opciones?.vacio) {
        ws.addRow({ c0: opciones.vacio })
        ws.getRow(2).font = { italic: true }
      }

      if (opciones?.totales) {
        const valores: Record<string, string | number> = {}
        columnas.forEach((c, i) => {
          const v = opciones.totales![c.header]
          if (v !== undefined) valores[`c${i}`] = v
        })
        ws.addRow(valores).font = { bold: true }
      }

      // El autofiltro se pone sobre el encabezado: en un reporte de flota
      // completa, filtrar por sucursal o por tipo desde el propio Excel es lo
      // primero que alguien intenta hacer.
      if (filas.length > 0) {
        ws.autoFilter = {
          from: { row: 1, column: 1 },
          to:   { row: 1, column: columnas.length },
        }
      }
    },

    hojaResumen(nombre, pares, opciones) {
      const ws = wb.addWorksheet(nombre.replace(/[:\\/?*[\]]/g, '-').slice(0, 31))
      ws.columns = [
        { header: 'Concepto', key: 'concepto', width: 52 },
        { header: 'Valor',    key: 'valor',    width: 24 },
      ]
      ws.getRow(1).font = { bold: true }
      for (const [concepto, valor] of pares) ws.addRow({ concepto, valor })
      // Las filas de moneda se indican por posición dentro de `pares` (base 0);
      // se desplazan en uno por el encabezado.
      for (const i of opciones?.moneda ?? []) {
        ws.getCell(i + 2, 2).numFmt = NUM_FMT.moneda!
      }
    },

    async guardar(nombreArchivo) {
      const buffer = await wb.xlsx.writeBuffer()
      descargar(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        nombreArchivo.endsWith('.xlsx') ? nombreArchivo : `${nombreArchivo}.xlsx`,
      )
    },
  }
}
