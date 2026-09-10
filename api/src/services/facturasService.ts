import * as repo from '../repositories/facturasRepo'
import { FacturaQuery } from '../schemas/facturaSchema'
import { AppError } from '../shared/errors'

export async function getAll(p: FacturaQuery) {
  const { data, total } = await repo.findAll(p)
  return { data, total, page: p.page, pageSize: p.pageSize }
}

/**
 * Los lotes que forman la factura. El endpoint los necesita ANTES de escribir,
 * para capturar el estado previo de cada uno en la bitácora. Si no hay ninguno,
 * el folio no corresponde a una compra de ese proveedor.
 */
export async function getIds(numFactura: string, proveedorId: number): Promise<number[]> {
  const ids = await repo.idsDeFactura(numFactura, proveedorId)
  // NotFoundError no sirve aquí: agrega " no encontrado" y con un folio de por
  // medio la frase queda coja. El 404 es el mismo.
  if (ids.length === 0) {
    throw new AppError(
      `No hay ninguna compra con el folio ${numFactura} de ese proveedor`, 404, 'NOT_FOUND',
    )
  }
  return ids
}

/**
 * El IVA y el descuento de la compra completa. Van juntos porque juntos forman
 * el total de la factura: el descuento se resta al subtotal y el IVA se calcula
 * sobre lo que queda, así que fijar uno sin el otro deja el total a medias.
 */
export async function setTotales(
  numFactura: string, proveedorId: number, tasa: number | null, descuento: number | null,
): Promise<number> {
  return repo.setTotales(numFactura, proveedorId, tasa, descuento)
}

/**
 * Corrige el folio de una compra completa.
 *
 * Si el folio destino ya existe en ese proveedor, las dos compras quedan como
 * una sola factura. Eso es legítimo —un mismo papel capturado en dos tandas—,
 * pero no puede ocurrir por accidente al corregir una letra: hace falta
 * `confirmar` para que pase. El código FOLIO_EXISTENTE es lo que el cliente
 * usa para preguntar y reintentar.
 *
 * Juntarlas no es un camino sin retorno: cada renglón puede volver a salirse
 * cambiándole el folio uno por uno (PUT /lotes/{id}).
 */
export async function setFolio(
  numFactura: string, proveedorId: number, nuevo: string, confirmar = false,
): Promise<number> {
  if (nuevo === numFactura) return 0
  if (!confirmar) {
    const existentes = await repo.renglonesConFolio(nuevo, proveedorId)
    if (existentes > 0) {
      throw new AppError(
        `Ese proveedor ya tiene otra compra con el folio ${nuevo} ` +
        `(${existentes} renglón${existentes === 1 ? '' : 'es'}). ` +
        'Continuar dejaría las dos como una sola factura.',
        409, 'FOLIO_EXISTENTE',
      )
    }
  }
  return repo.setFolio(numFactura, proveedorId, nuevo)
}
