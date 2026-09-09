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

/**
 * Corrige el folio de una compra completa. Se niega a escribir sobre un folio
 * que el mismo proveedor ya usa: eso no sería corregir sino fusionar dos
 * compras, y no habría forma de volver a separarlas.
 */
export async function setFolio(
  numFactura: string, proveedorId: number, nuevo: string,
): Promise<number> {
  if (nuevo === numFactura) return 0
  if (await repo.existeFolio(nuevo, proveedorId)) {
    throw new AppError(
      `Ese proveedor ya tiene una compra con el folio ${nuevo}. ` +
      'Renombrarla la juntaría con esta y no se podrían volver a separar.',
      409, 'CONFLICT',
    )
  }
  return repo.setFolio(numFactura, proveedorId, nuevo)
}
