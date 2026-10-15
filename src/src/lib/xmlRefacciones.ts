// Leer el XML (CFDI 4.0) de una factura de refacciones.
//
// A diferencia de la gasolina, aquí no hay un complemento que diga qué es cada
// concepto: lo que trae es el NÚMERO DE PARTE DEL PROVEEDOR (`NoIdentificacion`)
// y una descripción que cada quien escribe a su modo. Qué refacción del catálogo
// es lo decide una persona la primera vez, y se aprende. Ver la migración 070.
//
// Del CFDI se toma:
//
//   folio        Serie + Folio
//   fecha        Fecha (la de emisión)
//   proveedor    Emisor/@Rfc, que es como se reconoce
//   concepto     NoIdentificacion, ClaveProdServ, Descripcion, Cantidad,
//                ClaveUnidad, ValorUnitario, Importe, Descuento, y el IVA de su
//                Traslado 002
//
// LO QUE NO SE PUEDE LEER, SE RECHAZA con el motivo: otra moneda, un impuesto
// que no es IVA, retenciones, tasas de IVA distintas en la misma factura. Las
// notas de crédito y los pagos no son facturas de compra y se ignoran por ahora.

const NS_CFDI = 'http://www.sat.gob.mx/cfd/4'
const NS_TFD = 'http://www.sat.gob.mx/TimbreFiscalDigital'

export interface ConceptoXml {
  no_identificacion: string | null
  clave_prod_serv: string
  descripcion: string
  clave_unidad: string
  /** El nombre de la unidad como lo escribe el proveedor ("Litro", "PZA"). */
  unidad: string | null
  cantidad: number
  valor_unitario: number
  importe: number
  descuento: number
  iva: number
}

export interface FacturaRefaccionesXml {
  uuid: string
  serie: string | null
  folio: string
  fecha: string
  emisor_rfc: string
  emisor_nombre: string
  receptor_rfc: string
  /** En por ciento. null = la factura no trae IVA. */
  tasa_iva: number | null
  subtotal: number
  descuento: number
  iva: number
  total: number
  conceptos: ConceptoXml[]
}

/** Lo que se leyó: una factura que se puede importar, o por qué se deja fuera. */
export type LecturaXml =
  | { tipo: 'factura'; factura: FacturaRefaccionesXml }
  | { tipo: 'ignorado'; motivo: string; uuid: string | null }

export class XmlRefaccionesError extends Error {}

function attr(el: Element, nombre: string, donde: string): string {
  const v = el.getAttribute(nombre)?.trim()
  if (!v) throw new XmlRefaccionesError(`Falta ${nombre} en ${donde}.`)
  return v
}

function numero(v: string | null | undefined, donde: string): number {
  const n = Number(v ?? '0')
  if (!Number.isFinite(n)) throw new XmlRefaccionesError(`${donde}: "${v}" no es un número.`)
  return n
}

function hijos(el: Element, ns: string, nombre: string): Element[] {
  return Array.from(el.childNodes).filter(
    (n): n is Element => n.nodeType === 1
      && (n as Element).namespaceURI === ns && (n as Element).localName === nombre,
  )
}

const TIPOS: Record<string, string> = {
  E: 'Nota de crédito: por ahora no se importa.',
  P: 'Complemento de pago: no es una compra.',
  T: 'Carta porte de traslado: no es una compra.',
  N: 'Recibo de nómina: no es una compra.',
}

/** Lee el texto del XML. Lanza `XmlRefaccionesError` si es una factura que no se puede leer. */
export function leerFacturaRefacciones(xml: string, rfcEmpresa: string): LecturaXml {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new XmlRefaccionesError('El archivo no es un XML válido.')
  }
  const comp = doc.getElementsByTagNameNS(NS_CFDI, 'Comprobante')[0]
  if (!comp) throw new XmlRefaccionesError('No es un CFDI 4.0: falta el Comprobante.')
  const timbre = doc.getElementsByTagNameNS(NS_TFD, 'TimbreFiscalDigital')[0]
  const uuid = timbre?.getAttribute('UUID')?.trim().toUpperCase() ?? null

  const tipo = comp.getAttribute('TipoDeComprobante') ?? ''
  if (tipo !== 'I') {
    return { tipo: 'ignorado', uuid, motivo: TIPOS[tipo] ?? `Comprobante de tipo ${tipo}: no es una compra.` }
  }
  if (!uuid) throw new XmlRefaccionesError('El CFDI no está timbrado: falta el folio fiscal.')

  const emisor = hijos(comp, NS_CFDI, 'Emisor')[0]
  const receptor = hijos(comp, NS_CFDI, 'Receptor')[0]
  const conceptosEl = hijos(comp, NS_CFDI, 'Conceptos')[0]
  if (!emisor || !receptor || !conceptosEl) throw new XmlRefaccionesError('Al CFDI le faltan partes.')

  const receptorRfc = attr(receptor, 'Rfc', 'el receptor').toUpperCase()
  if (receptorRfc !== rfcEmpresa) {
    return { tipo: 'ignorado', uuid, motivo: `Está a nombre de ${receptorRfc}, no de la empresa.` }
  }

  const moneda = comp.getAttribute('Moneda') ?? 'MXN'
  if (moneda !== 'MXN') {
    throw new XmlRefaccionesError(`La factura está en ${moneda}. Captúrala a mano.`)
  }

  const tasas = new Set<number>()
  const conceptos = hijos(conceptosEl, NS_CFDI, 'Concepto').map((c, i): ConceptoXml => {
    const donde = `el concepto ${i + 1}`
    let iva = 0
    for (const t of Array.from(c.getElementsByTagNameNS(NS_CFDI, 'Traslado'))) {
      if (t.getAttribute('Impuesto') !== '002') {
        throw new XmlRefaccionesError(`${donde} trae un impuesto que no es IVA. Captúrala a mano.`)
      }
      if (t.getAttribute('TipoFactor') === 'Exento') {
        tasas.add(0)
        continue
      }
      tasas.add(Math.round(numero(t.getAttribute('TasaOCuota'), donde) * 10000) / 100)
      iva += numero(t.getAttribute('Importe'), donde)
    }
    if (c.getElementsByTagNameNS(NS_CFDI, 'Retencion').length > 0) {
      throw new XmlRefaccionesError(`${donde} trae retenciones. Captúrala a mano.`)
    }
    if (c.getElementsByTagNameNS(NS_CFDI, 'Traslado').length === 0) tasas.add(0)

    return {
      no_identificacion: c.getAttribute('NoIdentificacion')?.trim() || null,
      clave_prod_serv: attr(c, 'ClaveProdServ', donde),
      descripcion: attr(c, 'Descripcion', donde).replace(/^"+|"+$/g, '').trim(),
      clave_unidad: attr(c, 'ClaveUnidad', donde),
      unidad: c.getAttribute('Unidad')?.trim() || null,
      cantidad: numero(attr(c, 'Cantidad', donde), donde),
      valor_unitario: numero(attr(c, 'ValorUnitario', donde), donde),
      importe: numero(attr(c, 'Importe', donde), donde),
      descuento: numero(c.getAttribute('Descuento'), donde),
      iva,
    }
  })
  if (conceptos.length === 0) throw new XmlRefaccionesError('La factura no trae conceptos.')
  if (tasas.size > 1) {
    throw new XmlRefaccionesError(
      `La factura mezcla tasas de IVA (${[...tasas].map((t) => `${t}%`).join(', ')}). Captúrala a mano.`,
    )
  }
  const tasa = [...tasas][0]

  return {
    tipo: 'factura',
    factura: {
      uuid,
      serie: comp.getAttribute('Serie')?.trim() || null,
      folio: attr(comp, 'Folio', 'el comprobante'),
      fecha: attr(comp, 'Fecha', 'el comprobante').slice(0, 10),
      emisor_rfc: attr(emisor, 'Rfc', 'el emisor').toUpperCase(),
      emisor_nombre: emisor.getAttribute('Nombre')?.trim() ?? '',
      receptor_rfc: receptorRfc,
      tasa_iva: tasa > 0 ? tasa : null,
      subtotal: numero(attr(comp, 'SubTotal', 'el comprobante'), 'Subtotal'),
      descuento: numero(comp.getAttribute('Descuento'), 'Descuento'),
      iva: numero(
        hijos(comp, NS_CFDI, 'Impuestos')[0]?.getAttribute('TotalImpuestosTrasladados')
          ?? String(conceptos.reduce((s, c) => s + c.iva, 0)),
        'IVA',
      ),
      total: numero(attr(comp, 'Total', 'el comprobante'), 'Total'),
      conceptos,
    },
  }
}

/** Que los conceptos sumen lo impreso, al centavo. La API lo vuelve a revisar. */
export function descuadreXml(f: FacturaRefaccionesXml): string | null {
  const c = (n: number) => Math.round(n * 100) / 100
  const suma = (k: 'importe' | 'descuento' | 'iva') => c(f.conceptos.reduce((s, x) => s + x[k], 0))
  if (Math.abs(suma('importe') - f.subtotal) > 0.01) return 'Los conceptos no suman el subtotal.'
  if (Math.abs(suma('descuento') - f.descuento) > 0.01) return 'Los descuentos no suman el de la factura.'
  if (Math.abs(suma('iva') - f.iva) > 0.01) return 'El IVA de los conceptos no suma el de la factura.'
  if (Math.abs(c(f.subtotal - f.descuento + f.iva) - f.total) > 0.01) return 'Subtotal menos descuento más IVA no da el total.'
  return null
}

/**
 * Las claves del SAT de 70000000 en adelante son servicios: lo más probable es
 * que sea mano de obra. Es solo la sugerencia de la primera vez; lo decide
 * quien importa y se aprende.
 */
export function pareceServicio(c: ConceptoXml): boolean {
  return Number(c.clave_prod_serv) >= 70000000
}

/**
 * Unidades que ya son piezas. Las demás (litros, kilos, metros) piden decir
 * cuánto trae cada pieza: el aceite se factura en litros y se guarda por bote.
 */
const UNIDADES_PIEZA = new Set(['H87', 'E48', 'EA', 'XPK', 'SET', 'KT', 'PR', 'XBX', 'XUN'])

export function pideContenido(c: ConceptoXml): boolean {
  return !UNIDADES_PIEZA.has(c.clave_unidad.toUpperCase()) || !Number.isInteger(c.cantidad)
}

/** Lo más cercano a un número de serie válido (A-Z, 0-9 y guiones, 20 a lo más). */
export function serieSugerida(c: ConceptoXml): string {
  return (c.no_identificacion ?? '').toUpperCase().replace(/[^A-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 20)
}
