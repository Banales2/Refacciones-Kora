import * as repo from '../repositories/recargasRepo'
import type { RecargaConGasolinera } from '../repositories/recargasRepo'
import type { RecargaCreate, RecargaUpdate } from '../schemas/recargaSchema'
import { NotFoundError } from '../shared/errors'

export async function getByVehiculo(vehiculoId: number): Promise<RecargaConGasolinera[]> {
  return repo.findByVehiculo(vehiculoId)
}

export async function create(vehiculoId: number, data: RecargaCreate): Promise<RecargaConGasolinera> {
  if (!(await repo.vehiculoExists(vehiculoId))) throw new NotFoundError('Vehículo')
  return repo.create(vehiculoId, data)
}

export async function update(id: number, data: RecargaUpdate): Promise<RecargaConGasolinera> {
  const result = await repo.update(id, data)
  if (!result) throw new NotFoundError('Recarga')
  return result
}

export async function remove(id: number): Promise<void> {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Recarga')
}
