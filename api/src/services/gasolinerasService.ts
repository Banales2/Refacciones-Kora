import * as repo from '../repositories/gasolinerasRepo'
import type { Gasolinera } from '../repositories/gasolinerasRepo'
import type { GasolineraCreate, GasolineraUpdate } from '../schemas/gasolineraSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getAll(): Promise<Gasolinera[]> {
  return repo.findAll()
}

export async function create(data: GasolineraCreate): Promise<Gasolinera> {
  return repo.create(data.nombre, data.ubicacion)
}

export async function update(id: number, data: GasolineraUpdate): Promise<Gasolinera> {
  const result = await repo.update(id, data.nombre, data.ubicacion)
  if (!result) throw new NotFoundError('Gasolinera')
  return result
}

export async function remove(id: number): Promise<void> {
  const recargas = await repo.countRecargas(id)
  if (recargas > 0) {
    throw new ConflictError(
      `Esta gasolinera tiene ${recargas} recarga(s) registrada(s) y no puede eliminarse`
    )
  }
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Gasolinera')
}
