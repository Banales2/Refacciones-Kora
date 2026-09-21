import * as repo from '../repositories/manoObraRepo'
import * as facturasRepo from '../repositories/facturasRepo'
import * as tecnicosRepo from '../repositories/tecnicosRepo'
import * as revisionRepo from '../repositories/revisionRepo'
import { FacturaTaller, SinFacturarQuery } from '../schemas/manoObraSchema'
import { NotFoundError } from '../shared/errors'

// La factura del taller: la mano de obra del papel.
//
// Ver `docs/facturas-de-mantenimiento.md`.

/**
 * Da de alta la factura de un taller.
 *
 * QUÉ PASA POR DEBAJO Y POR QUÉ NO SE VE. Quien captura elige un TALLER; la
 * factura cuelga de un proveedor, porque su llave es (proveedor, folio) y tiene
 * que serlo: el mismo papel puede cobrar refacciones, y esas ya viven en
 * `facturas` bajo esa llave. `proveedorDeTaller` resuelve el puente —creando el
 * proveedor la primera vez que ese taller factura— y la pantalla nunca menciona
 * la palabra.
 *
 * SI EL PAPEL YA EXISTE, NO SE CREA OTRO. El caso normal de una factura mixta es
 * que alguien ya haya capturado sus refacciones como una compra: esa compra creó
 * la factura, y lo que falta es colgarle la mano de obra, no abrir un segundo
 * documento con el mismo folio. Por eso esto devuelve la que ya existía en vez
 * de fallar — y lo dice, para que la pantalla lleve a cuadrarla.
 */
export async function crearDeTaller(
  datos: FacturaTaller, registradaPor: string,
): Promise<{ id: number; ya_existia: boolean }> {
  const proveedorId = await tecnicosRepo.proveedorDeTaller(datos.tecnico_id)
  if (proveedorId === null) throw new NotFoundError('Taller')

  const existente = await facturasRepo.findByFolio(datos.num_factura, proveedorId)
  if (existente) return { id: existente.id, ya_existia: true }

  const id = await facturasRepo.crearDeTaller({
    proveedor_id: proveedorId,
    folio: datos.num_factura,
    fecha_compra: datos.fecha_compra,
    tasa_iva: datos.tasa_iva ?? null,
    descuento_pct: datos.descuento_pct ?? null,
    comprado_por: datos.comprado_por,
  }, registradaPor)

  return { id, ya_existia: false }
}

/**
 * Los mantenimientos que ninguna factura ha reclamado.
 *
 * Es el reverso del cuadre, y existe porque aquí sí se puede: un mantenimiento
 * se captura cuando el camión vuelve del taller, exista o no el papel, así que
 * el que falta por facturar se detecta solo. En refacciones no hay equivalente
 * —un lote no existe hasta que alguien captura la compra— y por eso allá hizo
 * falta un botón para registrar la factura que nadie había visto (045).
 */
export async function sinFacturar(p: SinFacturarQuery) {
  const r = await repo.sinFacturar(p)
  return { ...r, page: p.page, pageSize: p.pageSize }
}

/**
 * El taller desde el que se está capturando, a partir de la factura.
 *
 * La pantalla lo necesita para poder decir de quién es el papel sin nombrar al
 * proveedor. Si la factura no es de ningún taller —una compra de refacciones
 * normal— devuelve `null`, que es la respuesta correcta: esa factura no tiene
 * mano de obra que cuadrar.
 */
export async function tallerDeFactura(facturaId: number) {
  const factura = await revisionRepo.leerCabecera(facturaId)
  if (!factura) throw new NotFoundError('Factura')
  return tecnicosRepo.tallerDeProveedor(factura.proveedor_id)
}
