import * as repo from '../repositories/gasolinerasRepo'
import type { Gasolinera } from '../repositories/gasolinerasRepo'
import type { GasolineraCreate, GasolineraUpdate } from '../schemas/gasolineraSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getAll(incluirArchivados = false): Promise<Gasolinera[]> {
  return repo.findAll(incluirArchivados)
}

export async function create(data: GasolineraCreate): Promise<Gasolinera> {
  if (await repo.existsNombre(data.nombre)) {
    throw new ConflictError(`Ya existe una gasolinera con el nombre ${data.nombre}`)
  }
  return repo.create(data.nombre, data.ubicacion)
}

export async function update(id: number, data: GasolineraUpdate): Promise<Gasolinera> {
  if (data.nombre !== undefined && await repo.existsNombre(data.nombre, id)) {
    throw new ConflictError(`Ya existe una gasolinera con el nombre ${data.nombre}`)
  }
  const result = await repo.update(id, data.nombre, data.ubicacion)
  if (!result) throw new NotFoundError('Gasolinera')
  return result
}

