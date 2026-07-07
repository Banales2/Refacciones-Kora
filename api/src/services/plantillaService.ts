import * as repo from '../repositories/plantillaRepo'
import { NotFoundError } from '../shared/errors'
import type { PlantillaCreate, PlantillaUpdate } from '../repositories/plantillaRepo'

export async function getByModelo(modeloId: number) {
  return repo.findByModelo(modeloId)
}

export async function create(modeloId: number, data: Omit<PlantillaCreate, 'modelo_id'>) {
  const created = await repo.create({ ...data, modelo_id: modeloId })
  await repo.copyToVehicles(created)
  return created
}

export async function update(id: number, data: PlantillaUpdate) {
  const updated = await repo.update(id, data)
  if (!updated) throw new NotFoundError('Requerimiento de plantilla')
  await repo.syncLinked(updated)
  return updated
}

export async function remove(id: number) {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Requerimiento de plantilla')
}
