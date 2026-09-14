import * as repo from '../repositories/proveedoresRepo'
import type { Proveedor } from '../repositories/proveedoresRepo'
import type { ProveedorCreate, ProveedorUpdate } from '../schemas/proveedorSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getAll(incluirArchivados = false): Promise<Proveedor[]> {
  return repo.findAll(incluirArchivados)
}

export async function create(data: ProveedorCreate): Promise<Proveedor> {
  const nombre = data.nombre.trim()
  if (await repo.existsNombre(nombre)) {
    throw new ConflictError(`Ya existe un proveedor con el nombre ${nombre}`)
  }
  return repo.create(nombre, data.contacto ?? null, data.telefono || null)
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
    'telefono' in data ? (data.telefono || null) : undefined,
  )
  if (!result) throw new NotFoundError('Proveedor')
  return result
}

