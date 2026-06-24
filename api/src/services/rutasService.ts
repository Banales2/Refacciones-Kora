import * as repo from '../repositories/rutasRepo'
import { NotFoundError, ConflictError } from '../shared/errors'

export function getAll() { return repo.findAll() }

export function create(nombre: string, ubicacion: string) {
  return repo.create(nombre.trim(), ubicacion.trim())
}

export async function update(id: number, nombre?: string, ubicacion?: string) {
  const result = await repo.update(id, nombre?.trim(), ubicacion?.trim())
  if (!result) throw new NotFoundError('Ruta')
  return result
}

export async function remove(id: number) {
  const count = await repo.countTractocamiones(id)
  if (count > 0)
    throw new ConflictError(`Esta ruta tiene ${count} tractocamión(es) asignado(s) y no puede eliminarse`)
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Ruta')
}
