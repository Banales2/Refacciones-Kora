// Leer el XML (CFDI 4.0) de la factura de una gasolinera.
//
// NO DEPENDE DE LA GASOLINERA. Toda factura de combustible lleva el complemento
// de Hidrocarburos, y lo que se necesita sale de campos estándar del SAT:
//
//   producto     ClaveProdServ: 15101505 Diesel, 15101514 Magna, 15101515 Premium
//   litros       Cantidad
//   importe      Importe (menos su Descuento, si trae)
//   IVA          el Traslado 002 del concepto
//   estación     NumeroPermiso del complemento HidroYPetro
//   despacho     lo que va después del permiso en NoIdentificacion
//
// Con cuatro gasolineras distintas (Dakota, Bagaleza, Flogas, Vázquez) el
// formato fue el mismo. La descripción NO se usa: cada una escribe lo suyo
// ("DIESEL 34006", "DIESEL (Despacho 576356-0)", "DIESEL").
//
// EL IVA SE LEE, NO SE CALCULA. En combustible no se cobra sobre el IEPS, así
// que no es el 16% del importe. Ver la migración 065.
//
// LO QUE NO SE PUEDE LEER, SE RECHAZA con el motivo: un concepto que no es
// combustible, un impuesto que no es IVA, conceptos de dos estaciones. La API
// vuelve a comprobar las sumas antes de guardar.

const NS_CFDI = 'http://www.sat.gob.mx/cfd/4'
const NS_TFD = 'http://www.sat.gob.mx/TimbreFiscalDigital'
const NS_HYP = 'http://www.sat.gob.mx/hidrocarburospetroliferos'

/** Las claves del SAT de lo que se carga, con el nombre que usa el sistema. */
const PRODUCTO_POR_CLAVE: Record<string, 'Diesel' | 'Magna' | 'Premium'> = {
  '15101505': 'Diesel',
  '15101514': 'Magna',
  '15101515': 'Premium',
}

export interface RenglonGasolina {
  descripcion: 'Diesel' | 'Magna' | 'Premium'
  cantidad: number
  importe: number
  iva: number
  despacho: string | null
}

export interface FacturaGasolinaXml {
  uuid: string
  serie: string | null
  folio: string
  /** La fecha de emisión: es el corte del cuadre. */
  fecha: string
  permiso_cre: string
  emisor_rfc: string
  emisor_nombre: string
  receptor_rfc: string
  subtotal: number
  iva: number
  total: number
  renglones: RenglonGasolina[]
}

export class XmlGasolinaError extends Error {}

function attr(el: Element, nombre: string, donde: string): string {
  const v = el.getAttribute(nombre)?.trim()
  if (!v) throw new XmlGasolinaError(`Falta ${nombre} en ${donde}.`)
  return v
}

function numero(v: string | null | undefined, donde: string): number {
  const n = Number(v ?? '0')
  if (!Number.isFinite(n)) throw new XmlGasolinaError(`${donde}: "${v}" no es un número.`)
  return n
}

/** Los hijos directos con ese nombre, sin bajar a los de los conceptos. */
function hijos(el: Element, ns: string, nombre: string): Element[] {
  return Array.from(el.childNodes).filter(
    (n): n is Element => n.nodeType === 1
      && (n as Element).namespaceURI === ns && (n as Element).localName === nombre,
  )
}

/** Lee el texto del XML. Lanza `XmlGasolinaError` con el motivo si algo no está. */
export function leerFacturaGasolina(xml: string): FacturaGasolinaXml {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new XmlGasolinaError('El archivo no es un XML válido.')
  }

  const comp = doc.getElementsByTagNameNS(NS_CFDI, 'Comprobante')[0]
  if (!comp) throw new XmlGasolinaError('No es un CFDI 4.0: falta el Comprobante.')
  if (comp.getAttribute('TipoDeComprobante') !== 'I') {
    throw new XmlGasolinaError('No es una factura de ingreso (puede ser una nota de crédito o un pago).')
  }
  const timbre = doc.getElementsByTagNameNS(NS_TFD, 'TimbreFiscalDigital')[0]
  if (!timbre) throw new XmlGasolinaError('El CFDI no está timbrado: falta el folio fiscal.')
  const emisor = hijos(comp, NS_CFDI, 'Emisor')[0]
  const receptor = hijos(comp, NS_CFDI, 'Receptor')[0]
  const conceptos = hijos(comp, NS_CFDI, 'Conceptos')[0]
  if (!emisor || !receptor || !conceptos) throw new XmlGasolinaError('Al CFDI le faltan partes.')

  const permisos = new Set<string>()
  const renglones = hijos(conceptos, NS_CFDI, 'Concepto').map((c, i): RenglonGasolina => {
    const donde = `el concepto ${i + 1}`
    const clave = attr(c, 'ClaveProdServ', donde)
    const producto = PRODUCTO_POR_CLAVE[clave]
    if (!producto) {
      throw new XmlGasolinaError(
        `${donde} ("${c.getAttribute('Descripcion') ?? clave}") no es Diesel, Magna ni Premium. ` +
        'Esta factura no se puede importar; captúrala a mano.',
      )
    }

    let iva = 0
    for (const t of Array.from(c.getElementsByTagNameNS(NS_CFDI, 'Traslado'))) {
      if (t.getAttribute('Impuesto') !== '002') {
        throw new XmlGasolinaError(`${donde} trae un impuesto que no es IVA. Captúrala a mano.`)
      }
      iva += numero(t.getAttribute('Importe'), donde)
    }
    if (c.getElementsByTagNameNS(NS_CFDI, 'Retencion').length > 0) {
      throw new XmlGasolinaError(`${donde} trae retenciones. Captúrala a mano.`)
    }

    const hyp = c.getElementsByTagNameNS(NS_HYP, 'HidroYPetro')[0]
    const noId = c.getAttribute('NoIdentificacion')?.trim() ?? ''
    const permiso = hyp?.getAttribute('NumeroPermiso')?.trim()
      || /^(.+)-[^-]+$/.exec(noId)?.[1]
    if (!permiso) throw new XmlGasolinaError(`${donde} no dice de qué estación es (falta el permiso).`)
    permisos.add(permiso.toUpperCase())
    const despacho = noId.toUpperCase().startsWith(`${permiso.toUpperCase()}-`)
      ? noId.slice(permiso.length + 1) || null
      : null

    return {
      descripcion: producto,
      cantidad: numero(attr(c, 'Cantidad', donde), donde),
      importe: numero(attr(c, 'Importe', donde), donde) - numero(c.getAttribute('Descuento'), donde),
      iva,
      despacho,
    }
  })

  if (renglones.length === 0) throw new XmlGasolinaError('La factura no trae conceptos.')
  if (permisos.size > 1) {
    throw new XmlGasolinaError(
      `La factura trae cargas de ${permisos.size} estaciones (${[...permisos].join(', ')}). ` +
      'Captúrala a mano.',
    )
  }

  const subtotal = numero(attr(comp, 'SubTotal', 'el comprobante'), 'Subtotal')
    - numero(comp.getAttribute('Descuento'), 'Descuento')
  const total = numero(attr(comp, 'Total', 'el comprobante'), 'Total')

  return {
    uuid: attr(timbre, 'UUID', 'el timbre').toUpperCase(),
    serie: comp.getAttribute('Serie')?.trim() || null,
    folio: attr(comp, 'Folio', 'el comprobante'),
    fecha: attr(comp, 'Fecha', 'el comprobante').slice(0, 10),
    permiso_cre: [...permisos][0],
    emisor_rfc: attr(emisor, 'Rfc', 'el emisor').toUpperCase(),
    emisor_nombre: emisor.getAttribute('Nombre') ?? '',
    receptor_rfc: attr(receptor, 'Rfc', 'el receptor').toUpperCase(),
    subtotal,
    // Lo que el documento declara de IVA; si no lo trae, la suma de conceptos.
    iva: numero(
      hijos(comp, NS_CFDI, 'Impuestos')[0]?.getAttribute('TotalImpuestosTrasladados')
        ?? String(renglones.reduce((s, r) => s + r.iva, 0)),
      'IVA',
    ),
    total,
    renglones,
  }
}
