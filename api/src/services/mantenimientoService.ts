import * as repo from '../repositories/mantenimientoRepo'
import { NotFoundError } from '../shared/errors'

export async function getByVehiculo(vehiculoId: number) {
  return repo.findByVehiculo(vehiculoId)
}

export async function create(vehiculoId: number, data: Omit<repo.MantenimientoCreate, 'vehiculo_id'>) {
  return repo.create({ ...data, vehiculo_id: vehiculoId })
}

export async function update(id: number, data: repo.MantenimientoUpdate) {
  const updated = await repo.update(id, data)
  if (!updated) throw new NotFoundError('Mantenimiento')
  return updated
}

export async function remove(id: number) {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Mantenimiento')
}
