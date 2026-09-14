import * as repo from '../repositories/tecnicosRepo'
import type { Tecnico } from '../repositories/tecnicosRepo'
import type { TecnicoCreate, TecnicoUpdate } from '../schemas/tecnicoSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getAll(incluirArchivados = false): Promise<Tecnico[]> {
  return repo.findAll(incluirArchivados)
}

export async function create(data: TecnicoCreate): Promise<Tecnico> {
  if (await repo.existsNombre(data.nombre)) {
    throw new ConflictError(`Ya existe un técnico con el nombre ${data.nombre}`)
  }
  return repo.create(data.nombre, data.ubicacion, data.contacto ?? null)
}

export async function update(id: number, data: TecnicoUpdate): Promise<Tecnico> {
  if (data.nombre !== undefined && await repo.existsNombre(data.nombre, id)) {
    throw new ConflictError(`Ya existe un técnico con el nombre ${data.nombre}`)
  }
  const result = await repo.update(id, data.nombre, data.ubicacion, data.contacto)
  if (!result) throw new NotFoundError('Técnico')
  return result
}

