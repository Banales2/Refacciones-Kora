import * as repo from '../repositories/segurosRepo'
import type { Seguro } from '../repositories/segurosRepo'
import type { SeguroCreate, SeguroUpdate } from '../schemas/seguroSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getAll(): Promise<Seguro[]> {
  return repo.findAll()
}

export async function create(data: SeguroCreate): Promise<Seguro> {
  return repo.create(data.poliza, data.compania, data.fecha_expiracion)
}

export async function update(id: number, data: SeguroUpdate): Promise<Seguro> {
  const result = await repo.update(id, data.poliza, data.compania, data.fecha_expiracion)
  if (!result) throw new NotFoundError('Seguro')
  return result
}

export async function remove(id: number): Promise<void> {
  const vehiculos = await repo.countVehiculos(id)
  if (vehiculos > 0) {
    throw new ConflictError(
      `Este seguro está asignado a ${vehiculos} vehículo(s) y no puede eliminarse`
    )
  }
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Seguro')
}

export async function assignVehiculos(id: number, vehiculoIds: number[]): Promise<void> {
  const seguro = await repo.findById(id)
  if (!seguro) throw new NotFoundError('Seguro')
  await repo.assignVehiculos(id, vehiculoIds)
}

export async function unassignVehiculo(id: number, vehiculoId: number): Promise<void> {
  const ok = await repo.unassignVehiculo(id, vehiculoId)
  if (!ok) throw new NotFoundError('Vehículo en este seguro')
}
