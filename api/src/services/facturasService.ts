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

export async function setIva(
  numFactura: string, proveedorId: number, tasa: number | null,
): Promise<number> {
  return repo.setIva(numFactura, proveedorId, tasa)
}
