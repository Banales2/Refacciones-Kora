import * as repo from '../repositories/preciosProveedorRepo'
import type { PrecioProveedor } from '../repositories/preciosProveedorRepo'
import type { PrecioProveedorCreate, PrecioProveedorUpdate } from '../schemas/precioProveedorSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getByProveedor(proveedorId: number): Promise<PrecioProveedor[]> {
  if (!(await repo.proveedorExists(proveedorId))) throw new NotFoundError('Proveedor')
  return repo.findByProveedor(proveedorId)
}

export async function create(
  proveedorId: number, data: PrecioProveedorCreate, registradoPor: string
): Promise<PrecioProveedor> {
  if (!(await repo.proveedorExists(proveedorId))) throw new NotFoundError('Proveedor')
  // Se cotizan refacciones del catálogo: si la pieza no existe, el 404 dice qué
  // pasó mejor que el error de llave foránea.
  if (!(await repo.piezaExists(data.pieza_id))) throw new NotFoundError('Refacción')
  if (await repo.existsMismoDia(proveedorId, data.pieza_id, data.fecha)) {
    throw new ConflictError(
      'Ya hay un precio de esa refacción con este proveedor en esa fecha. Edítalo en vez de capturarlo otra vez.'
    )
  }
  return repo.create(proveedorId, data, registradoPor)
}

export async function update(id: number, data: PrecioProveedorUpdate): Promise<PrecioProveedor> {
  const actual = await repo.findById(id)
  if (!actual) throw new NotFoundError('Precio')
  // Mover la fecha puede chocar con otro precio de la misma refacción.
  if (data.fecha !== undefined &&
      await repo.existsMismoDia(actual.proveedor_id, actual.pieza_id, data.fecha, id)) {
    throw new ConflictError(
      'Ya hay un precio de esa refacción con este proveedor en esa fecha.'
    )
  }
  const result = await repo.update(id, data)
  if (!result) throw new NotFoundError('Precio')
  return result
}

export async function remove(id: number): Promise<void> {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Precio')
}
