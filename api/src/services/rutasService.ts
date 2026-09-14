import * as repo from '../repositories/rutasRepo'
import { NotFoundError, ConflictError } from '../shared/errors'

export function getAll(incluirArchivados = false) { return repo.findAll(incluirArchivados) }

export async function create(nombre: string, ubicacion: string) {
  const n = nombre.trim()
  if (await repo.existsNombre(n)) {
    throw new ConflictError(`Ya existe un traslado con el nombre ${n}`)
  }
  return repo.create(n, ubicacion.trim())
}

export async function update(id: number, nombre?: string, ubicacion?: string) {
  const n = nombre?.trim()
  if (n !== undefined && await repo.existsNombre(n, id)) {
    throw new ConflictError(`Ya existe un traslado con el nombre ${n}`)
  }
  const result = await repo.update(id, n, ubicacion?.trim())
  if (!result) throw new NotFoundError('Ruta')
  return result
}

