import * as repo from '../repositories/modelosRepo'
import { NotFoundError, ConflictError } from '../shared/errors'

export function getAll() {
  return repo.findAll()
}

export async function create(marca: string, nombre: string, anio: number | null, tiposPermitidos?: string[]) {
  const m = marca.trim(), n = nombre.trim()
  if (await repo.existsDuplicate(m, n, anio)) {
    throw new ConflictError('Ya existe un modelo con esa marca, nombre y año')
  }
  return repo.create(m, n, anio, tiposPermitidos)
}

export async function update(id: number, marca?: string, nombre?: string, anio?: number | null, tiposPermitidos?: string[]) {
  const actual = await repo.findById(id)
  if (!actual) throw new NotFoundError('Modelo')

  // Valores efectivos tras el update (los no enviados conservan el actual).
  const m = marca?.trim() ?? actual.marca
  const n = nombre?.trim() ?? actual.nombre
  const a = anio !== undefined ? anio : actual.anio
  if (await repo.existsDuplicate(m, n, a, id)) {
    throw new ConflictError('Ya existe un modelo con esa marca, nombre y año')
  }

  const result = await repo.update(id, marca?.trim(), nombre?.trim(), anio, tiposPermitidos)
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
