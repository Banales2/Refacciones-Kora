import * as repo from '../repositories/modelosRepo'
import { NotFoundError, ConflictError } from '../shared/errors'

export function getAll() {
  return repo.findAll()
}

export async function create(marca: string, nombre: string, tiposPermitidos?: string[]) {
  return repo.create(marca.trim(), nombre.trim(), tiposPermitidos)
}

export async function update(id: number, marca?: string, nombre?: string, tiposPermitidos?: string[]) {
  const result = await repo.update(id, marca?.trim(), nombre?.trim(), tiposPermitidos)
  if (!result) throw new NotFoundError('Modelo')
  return result
}

export async function remove(id: number) {
  const count = await repo.countVehiculos(id)
  if (count > 0)
    throw new ConflictError(`Este modelo tiene ${count} vehículo(s) asignado(s) y no puede eliminarse`)
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Modelo')
}
