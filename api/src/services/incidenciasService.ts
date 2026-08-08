import * as repo from '../repositories/incidenciasRepo'
import { NotFoundError } from '../shared/errors'
import type { IncidenciaCreate, IncidenciaUpdate } from '../repositories/incidenciasRepo'

export async function getByVehiculo(vehiculoId: number) {
  return repo.findByVehiculo(vehiculoId)
}

export async function getAll() {
  return repo.findAllConVehiculo()
}

export async function create(
  vehiculoId: number,
  data: Omit<IncidenciaCreate, 'vehiculo_id'>,
  autorizadoPor: string,
) {
  return repo.create({ ...data, vehiculo_id: vehiculoId }, autorizadoPor)
}

export async function update(id: number, data: IncidenciaUpdate) {
  const updated = await repo.update(id, data)
  if (!updated) throw new NotFoundError('Incidencia')
  return updated
}

export async function remove(id: number) {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Incidencia')
}
