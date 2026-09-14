import * as repo from '../repositories/sucursalesRepo'
import { NotFoundError, ConflictError } from '../shared/errors'

export function getAll(incluirArchivados = false) { return repo.findAll(incluirArchivados) }

export function create(nombre: string, ubicacion: string) {
  return repo.create(nombre.trim(), ubicacion.trim())
}

export async function update(id: number, nombre?: string, ubicacion?: string) {
  const result = await repo.update(id, nombre?.trim(), ubicacion?.trim())
  if (!result) throw new NotFoundError('Sucursal')
  return result
}

