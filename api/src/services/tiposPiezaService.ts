import * as repo from '../repositories/tiposPiezaRepo'
import type { TipoPieza } from '../repositories/tiposPiezaRepo'
import type { TipoPiezaCreate, TipoPiezaUpdate } from '../schemas/tipoPiezaSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getAll(incluirArchivados = false): Promise<TipoPieza[]> {
  return repo.findAll(incluirArchivados)
}

export async function create(data: TipoPiezaCreate): Promise<TipoPieza> {
  const nombre = data.nombre.trim()
  if (await repo.existsNombre(nombre)) {
    throw new ConflictError(`Ya existe un tipo de pieza con el nombre ${nombre}`)
  }
  return repo.create(nombre, data.rastreo_individual)
}

export async function update(id: number, data: TipoPiezaUpdate): Promise<TipoPieza> {
  const nombre = data.nombre?.trim()
  const rastreo = data.rastreo_individual

  // Ni nombre ni flag: no hay nada que escribir. Se devuelve lo que hay en vez
  // de un UPDATE que no cambia nada.
  if (nombre === undefined && rastreo === undefined) {
    const actual = await repo.findById(id)
    if (!actual) throw new NotFoundError('Tipo de pieza')
    return actual
  }

  if (nombre !== undefined && await repo.existsNombre(nombre, id)) {
    throw new ConflictError(`Ya existe un tipo de pieza con el nombre ${nombre}`)
  }

  const result = await repo.update(id, nombre, rastreo)
  if (!result) throw new NotFoundError('Tipo de pieza')
  return result
}

