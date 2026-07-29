import * as repo from '../repositories/tiposPiezaRepo'
import type { TipoPieza } from '../repositories/tiposPiezaRepo'
import type { TipoPiezaCreate, TipoPiezaUpdate } from '../schemas/tipoPiezaSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getAll(): Promise<TipoPieza[]> {
  return repo.findAll()
}

export async function create(data: TipoPiezaCreate): Promise<TipoPieza> {
  const nombre = data.nombre.trim()
  if (await repo.existsNombre(nombre)) {
    throw new ConflictError(`Ya existe un tipo de pieza con el nombre ${nombre}`)
  }
  return repo.create(nombre)
}

export async function update(id: number, data: TipoPiezaUpdate): Promise<TipoPieza> {
  const nombre = data.nombre?.trim()
  if (nombre === undefined) {
    const actual = await repo.findById(id)
    if (!actual) throw new NotFoundError('Tipo de pieza')
    return actual
  }
  if (await repo.existsNombre(nombre, id)) {
    throw new ConflictError(`Ya existe un tipo de pieza con el nombre ${nombre}`)
  }
  const result = await repo.update(id, nombre)
  if (!result) throw new NotFoundError('Tipo de pieza')
  return result
}

export async function remove(id: number): Promise<void> {
  const { modelos, vehiculos, piezas } = await repo.countReferencias(id)
  if (modelos > 0 || vehiculos > 0 || piezas > 0) {
    const partes = [
      modelos   > 0 ? `${modelos} modelo(s) lo requieren`          : null,
      vehiculos > 0 ? `${vehiculos} vehículo(s) lo necesitan`      : null,
      piezas    > 0 ? `${piezas} refacción(es) son de este tipo`   : null,
    ].filter(Boolean)
    throw new ConflictError(`No se puede eliminar: ${partes.join(', ')}`)
  }
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Tipo de pieza')
}
