import * as repo from '../repositories/plantillaRepo'
import { NotFoundError, ConflictError } from '../shared/errors'
import type { TriggerMode, PlantillaCreate, PlantillaUpdate } from '../repositories/plantillaRepo'

export async function getByModelo(modeloId: number) {
  return repo.findByModelo(modeloId)
}

export async function create(modeloId: number, data: Omit<PlantillaCreate, 'modelo_id'>) {
  return repo.create({ ...data, modelo_id: modeloId })
}

export async function update(id: number, data: PlantillaUpdate) {
  const updated = await repo.update(id, data)
  if (!updated) throw new NotFoundError('Requerimiento de plantilla')
  return updated
}

export async function remove(id: number) {
  const count = await repo.countExclusivos(id)
  if (count > 0)
    throw new ConflictError(
      `No se puede eliminar: ${count} vehículo${count !== 1 ? 's' : ''} tiene${count !== 1 ? 'n' : ''} este requerimiento asignado`
    )
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Requerimiento de plantilla')
}
