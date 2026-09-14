import * as repo from '../repositories/conductoresRepo'
import type { Conductor } from '../repositories/conductoresRepo'
import type { ConductorCreate, ConductorUpdate } from '../schemas/conductorSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getAll(incluirArchivados = false): Promise<Conductor[]> {
  return repo.findAll(incluirArchivados)
}

export async function create(data: ConductorCreate): Promise<Conductor> {
  if (await repo.existsNombre(data.nombre)) {
    throw new ConflictError(`Ya existe un conductor con el nombre ${data.nombre}`)
  }
  return repo.create(data)
}

export async function update(id: number, data: ConductorUpdate): Promise<Conductor> {
  if (data.nombre !== undefined && await repo.existsNombre(data.nombre, id)) {
    throw new ConflictError(`Ya existe un conductor con el nombre ${data.nombre}`)
  }
  const result = await repo.update(id, data)
  if (!result) throw new NotFoundError('Conductor')
  return result
}

