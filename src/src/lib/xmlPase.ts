// Leer el XML del CFDI de PASE: la factura de casetas con un renglón por cruce.
//
// POR QUÉ EL XML Y NO EL PDF. Leído a máquina, el PDF mezcla columnas de un
// renglón con las del siguiente. El XML trae, además del CFDI estándar, una
// addenda de Interfactura con un `if:Cuerpo` por cruce y cada dato en su
// atributo: Renglon, Tag, Fecha, Hora, Evento, Carril, Caseta, Clase, Importe,
// Iva y Total. Leer atributos con nombre no adivina nada.
//
// LO QUE NO SE PUEDE LEER, SE RECHAZA. Si falta un atributo, si un número no es
// número o si la cuenta de cruces no es la que el documento declara, la función
// lanza un error con el renglón y el motivo. No hay "lo que se pudo": este repo
// ya quitó una vez un lector de PDF que se equivocaba en silencio. La API vuelve
// a comprobar que los cruces sumen el total antes de guardar.
//
// Ver `db/migrations/064_facturas_de_casetas.sql`.

const NS_CFDI = 'http://www.sat.gob.mx/cfd/4'
const NS_TFD = 'http://www.sat.gob.mx/TimbreFiscalDigital'
const NS_IF = 'https://www.interfactura.com/Schemas/Documentos'

export interface CrucePase {
  renglon: number
  tag: string
  /** `YYYY-MM-DDTHH:mm:ss`, la hora de la caseta, sin zona. */
  fecha_hora: string
  evento: string | null
  carril: string | null
  caseta: string
  descripcion: string
  clase: number
  importe: number
  iva: number
  total: number
}

export interface FacturaPase {
  uuid: string
  serie: string | null
  folio: string
  fecha_emision: string
  fecha_limite_pago: string | null
  periodo: string | null
  periodo_desde: string | null
  periodo_hasta: string | null
  emisor: string
  receptor: string
  subtotal: number
  iva: number
  total: number
  cruces: CrucePase[]
}

export class XmlPaseError extends Error {}

function attr(el: Element, nombre: string, donde: string): string {
  const v = el.getAttribute(nombre)
  if (v === null || v.trim() === '') {
    throw new XmlPaseError(`Falta ${nombre} en ${donde}.`)
  }
  return v.trim()
}

function opcional(el: Element, nombre: string): string | null {
  const v = el.getAttribute(nombre)?.trim()
  return v ? v : null
}

function numero(v: string, donde: string): number {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new XmlPaseError(`${donde}: "${v}" no es un número.`)
  return n
}

/** `21/09/2026` → `2026-09-21`. Acepta la hora detrás, que se ignora. */
function fechaDMY(v: string, donde: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v)
  if (!m) throw new XmlPaseError(`${donde}: "${v}" no es una fecha dd/mm/aaaa.`)
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

const MESES: Record<string, number> = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7,
  AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
}

function iso(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Las fechas del periodo, sacadas del texto: "747-I DEL 21 AL 30 DE SEPTIEMBRE
 * DEL 2026", o con dos meses cuando la decena los cruza. Si PASE cambia la
 * redacción devuelve null: se pierde el aviso de cruces fuera del periodo, no
 * la factura.
 */
export function leerPeriodo(texto: string): { desde: string; hasta: string } | null {
  const t = texto.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

  const unMes = /DEL (\d{1,2}) AL (\d{1,2}) DE ([A-Z]+) DEL? (\d{4})/.exec(t)
  if (unMes && MESES[unMes[3]]) {
    const [, d1, d2, mes, anio] = unMes
    return { desde: iso(+anio, MESES[mes], +d1), hasta: iso(+anio, MESES[mes], +d2) }
  }

  const dosMeses =
    /DEL (\d{1,2}) DE ([A-Z]+)(?: DEL? (\d{4}))? AL (\d{1,2}) DE ([A-Z]+) DEL? (\d{4})/.exec(t)
  if (dosMeses && MESES[dosMeses[2]] && MESES[dosMeses[5]]) {
    const [, d1, m1, a1, d2, m2, a2] = dosMeses
    // Sin año en la primera mitad, diciembre → enero es del año anterior.
    const anio1 = a1 ? +a1 : MESES[m1] > MESES[m2] ? +a2 - 1 : +a2
    return { desde: iso(anio1, MESES[m1], +d1), hasta: iso(+a2, MESES[m2], +d2) }
  }

  return null
}

/** Lee el texto del XML. Lanza `XmlPaseError` con el motivo si algo no está. */
export function leerFacturaPase(xml: string): FacturaPase {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new XmlPaseError('El archivo no es un XML válido.')
  }

  const comp = doc.getElementsByTagNameNS(NS_CFDI, 'Comprobante')[0]
  if (!comp) throw new XmlPaseError('No es un CFDI: falta el Comprobante.')
  const timbre = doc.getElementsByTagNameNS(NS_TFD, 'TimbreFiscalDigital')[0]
  if (!timbre) throw new XmlPaseError('El CFDI no está timbrado: falta el folio fiscal.')
  const emisor = doc.getElementsByTagNameNS(NS_CFDI, 'Emisor')[0]
  const receptor = doc.getElementsByTagNameNS(NS_CFDI, 'Receptor')[0]
  const encabezado = doc.getElementsByTagNameNS(NS_IF, 'Encabezado')[0]
  const cuerpos = Array.from(doc.getElementsByTagNameNS(NS_IF, 'Cuerpo'))
  if (!encabezado || cuerpos.length === 0) {
    throw new XmlPaseError(
      'El XML no trae el detalle de cruces de PASE (addenda de Interfactura). ' +
      '¿Es una factura de casetas?',
    )
  }

  // El IVA del documento: el total de traslados del CFDI. Es el hijo directo de
  // Comprobante, no el de cada concepto.
  const impuestos = Array.from(comp.childNodes).find(
    (n): n is Element => n.nodeType === 1
      && (n as Element).namespaceURI === NS_CFDI && (n as Element).localName === 'Impuestos',
  )
  const iva = impuestos
    ? numero(attr(impuestos, 'TotalImpuestosTrasladados', 'los impuestos'), 'IVA')
    : numero(attr(encabezado, 'TotalIva', 'el encabezado'), 'IVA')

  const cruces = cuerpos.map((c, i): CrucePase => {
    const donde = `el cruce ${c.getAttribute('Renglon') ?? i + 1}`
    const hora = attr(c, 'Hora', donde)
    if (!/^\d{2}:\d{2}:\d{2}$/.test(hora)) throw new XmlPaseError(`${donde}: hora "${hora}" inválida.`)
    return {
      renglon: numero(attr(c, 'Renglon', donde), donde),
      tag: attr(c, 'Tag', donde).replace(/\.+$/, '').toUpperCase(),
      fecha_hora: `${fechaDMY(attr(c, 'Fecha', donde), donde)}T${hora}`,
      evento: opcional(c, 'Evento'),
      carril: opcional(c, 'Carril'),
      caseta: attr(c, 'Caseta', donde),
      descripcion: attr(c, 'Concepto', donde),
      clase: numero(attr(c, 'Clase', donde), donde),
      importe: numero(attr(c, 'Importe', donde), donde),
      iva: numero(attr(c, 'Iva', donde), donde),
      total: numero(attr(c, 'Total', donde), donde),
    }
  })

  const declarados = opcional(encabezado, 'TotalRenglones')
  if (declarados !== null && Number(declarados) !== cruces.length) {
    throw new XmlPaseError(
      `El documento dice traer ${declarados} cruces y se leyeron ${cruces.length}.`,
    )
  }

  const periodo = opcional(encabezado, 'Periodo')
  const fechas = periodo ? leerPeriodo(periodo) : null
  const limite = opcional(encabezado, 'FechaLimitePago')

  return {
    uuid: attr(timbre, 'UUID', 'el timbre').toUpperCase(),
    serie: opcional(comp, 'Serie'),
    folio: attr(comp, 'Folio', 'el comprobante'),
    fecha_emision: attr(comp, 'Fecha', 'el comprobante').slice(0, 19),
    fecha_limite_pago: limite ? fechaDMY(limite, 'la fecha límite de pago') : null,
    periodo,
    periodo_desde: fechas?.desde ?? null,
    periodo_hasta: fechas?.hasta ?? null,
    emisor: emisor?.getAttribute('Nombre') ?? '',
    receptor: receptor?.getAttribute('Nombre') ?? '',
    subtotal: numero(attr(comp, 'SubTotal', 'el comprobante'), 'Subtotal'),
    iva,
    total: numero(attr(comp, 'Total', 'el comprobante'), 'Total'),
    cruces,
  }
}
