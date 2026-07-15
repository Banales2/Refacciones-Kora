import * as repo from '../repositories/conductoresRepo'
import type { Conductor } from '../repositories/conductoresRepo'
import type { ConductorCreate, ConductorUpdate } from '../schemas/conductorSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getAll(): Promise<Conductor[]> {
  return repo.findAll()
}

export async function create(data: ConductorCreate): Promise<Conductor> {
  if (await repo.existsNombre(data.nombre)) {
    throw new ConflictError(`Ya existe un conductor con el nombre ${data.nombre}`)
  }
  return repo.create(data.nombre)
}

export async function update(id: number, data: ConductorUpdate): Promise<Conductor> {
  if (data.nombre !== undefined && await repo.existsNombre(data.nombre, id)) {
    throw new ConflictError(`Ya existe un conductor con el nombre ${data.nombre}`)
  }
  const result = await repo.update(id, data.nombre)
  if (!result) throw new NotFoundError('Conductor')
  return result
}

export async function remove(id: number): Promise<void> {
  const recargas = await repo.countRecargas(id)
  if (recargas > 0) {
    throw new ConflictError(
      `Este conductor tiene ${recargas} recarga(s) registrada(s) y no puede eliminarse`
    )
  }
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Conductor')
}
