import * as repo from '../repositories/proveedoresRepo'
import type { Proveedor } from '../repositories/proveedoresRepo'
import type { ProveedorCreate, ProveedorUpdate } from '../schemas/proveedorSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getAll(): Promise<Proveedor[]> {
  return repo.findAll()
}

export async function create(data: ProveedorCreate): Promise<Proveedor> {
  const nombre = data.nombre.trim()
  if (await repo.existsNombre(nombre)) {
    throw new ConflictError(`Ya existe un proveedor con el nombre ${nombre}`)
  }
  return repo.create(nombre, data.contacto ?? null)
}

export async function update(id: number, data: ProveedorUpdate): Promise<Proveedor> {
  const nombre = data.nombre?.trim()
  if (nombre !== undefined && await repo.existsNombre(nombre, id)) {
    throw new ConflictError(`Ya existe un proveedor con el nombre ${nombre}`)
  }
  const result = await repo.update(
    id,
    nombre,
    'contacto' in data ? (data.contacto ?? null) : undefined,
  )
  if (!result) throw new NotFoundError('Proveedor')
  return result
}

export async function remove(id: number): Promise<void> {
  const lotes = await repo.countLotes(id)
  if (lotes > 0) {
    throw new ConflictError(
      `Este proveedor tiene ${lotes} lote(s) registrado(s) y no puede eliminarse`
    )
  }
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Proveedor')
}
