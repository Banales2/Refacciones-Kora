import * as repo from '../repositories/facturasRepo'
import { FacturaQuery } from '../schemas/facturaSchema'
import { AppError } from '../shared/errors'

export async function getAll(p: FacturaQuery) {
  const { data, total } = await repo.findAll(p)
  return { data, total, page: p.page, pageSize: p.pageSize }
}

/**
 * La factura de ese proveedor con ese folio.
 *
 * Los endpoints la piden por (folio, proveedor) y no por id porque así llega del
 * cliente, que es donde el usuario la reconoce. Desde la migración 026 el par es
 * único, así que identifica una sola fila.
 */
export async function getId(folio: string, proveedorId: number): Promise<number> {
  const factura = await repo.findByFolio(folio, proveedorId)
  // NotFoundError no sirve aquí: agrega " no encontrado" y con un folio de por
  // medio la frase queda coja. El 404 es el mismo.
  if (!factura) {
    throw new AppError(
      `No hay ninguna compra con el folio ${folio} de ese proveedor`, 404, 'NOT_FOUND',
    )
  }
  return factura.id
}

/** Los lotes de la factura. El endpoint los necesita para la bitácora. */
export async function getIdsDeLotes(facturaId: number): Promise<number[]> {
  return repo.idsDeLotes(facturaId)
}

/**
 * El IVA y el descuento de la compra. Van juntos porque juntos forman su total:
 * el descuento se resta al subtotal y el IVA se calcula sobre lo que queda, así
 * que fijar uno sin el otro deja el total a medias.
 *
 * Ya no hay que escribirlos en cada renglón: son de la cabecera.
 */
export async function setTotales(
  facturaId: number, tasa: number | null, descuento: number | null,
): Promise<void> {
  return repo.setTotales(facturaId, tasa, descuento)
}

/**
 * Corrige el folio mal capturado de una compra.
 *
 * Si el folio destino ya es de otra factura de ese proveedor, las dos son el
 * mismo papel capturado en dos tandas y se fusionan: los renglones se mueven a
 * la que ya existía y la vacía se borra. Eso es legítimo, pero no puede ocurrir
 * por accidente al corregir una letra, así que hace falta `confirmar`. El código
 * FOLIO_EXISTENTE es lo que el cliente usa para preguntar y reintentar.
 *
 * Fusionar no es un camino sin retorno: cada renglón puede volver a salirse
 * cambiándole el folio uno por uno (PUT /lotes/{id}).
 */
export async function setFolio(
  facturaId: number, proveedorId: number, nuevo: string, confirmar = false,
): Promise<{ fusionada: boolean; renglones: number }> {
  const destino = await repo.findByFolio(nuevo, proveedorId)

  if (!destino) {
    await repo.setFolio(facturaId, nuevo)
    return { fusionada: false, renglones: 0 }
  }

  // Ya tenía ese folio: no hay nada que hacer y tampoco nada que preguntar.
  if (destino.id === facturaId) return { fusionada: false, renglones: 0 }

  if (!confirmar) {
    const existentes = (await repo.idsDeLotes(destino.id)).length
    throw new AppError(
      `Ese proveedor ya tiene otra compra con el folio ${nuevo} ` +
      `(${existentes} renglón${existentes === 1 ? '' : 'es'}). ` +
      'Continuar dejaría las dos como una sola factura.',
      409, 'FOLIO_EXISTENTE',
    )
  }

  const renglones = await repo.fusionar(facturaId, destino.id)
  return { fusionada: true, renglones }
}
