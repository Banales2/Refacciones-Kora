import * as repo from '../repositories/requerimentosRepo'
import { NotFoundError } from '../shared/errors'
import type { RequerimientoCreate, RequerimientoUpdate } from '../repositories/requerimentosRepo'

export async function getByVehiculo(vehiculoId: number) {
  return repo.findByVehiculo(vehiculoId)
}

export async function create(vehiculoId: number, data: Omit<RequerimientoCreate, 'vehiculo_id'>) {
  return repo.create({ ...data, vehiculo_id: vehiculoId })
}

export async function update(id: number, data: RequerimientoUpdate) {
  const updated = await repo.update(id, data)
  if (!updated) throw new NotFoundError('Requerimiento')
  return updated
}

export async function remove(id: number) {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Requerimiento')
}
