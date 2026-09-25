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
  const mide = data.mide_desgaste

  // Apagar la medición se lleva el mínimo: un umbral de un tipo que ya no se
  // mide es un número que nadie compara contra nada, y el día que alguien
  // vuelva a encenderla se lo encontraría puesto sin saber de dónde salió.
  const desgaste = mide === undefined
    ? undefined
    : { mide, minimo: mide ? (data.desgaste_minimo_mm ?? null) : null }

  // Nada que escribir: se devuelve lo que hay en vez de un UPDATE que no
  // cambia nada.
  if (nombre === undefined && rastreo === undefined && desgaste === undefined) {
    const actual = await repo.findById(id)
    if (!actual) throw new NotFoundError('Tipo de pieza')
    return actual
  }

  if (nombre !== undefined && await repo.existsNombre(nombre, id)) {
    throw new ConflictError(`Ya existe un tipo de pieza con el nombre ${nombre}`)
  }

  const result = await repo.update(id, nombre, rastreo, desgaste)
  if (!result) throw new NotFoundError('Tipo de pieza')
  return result
}

