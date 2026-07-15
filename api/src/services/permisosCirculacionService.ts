import * as repo from '../repositories/permisosCirculacionRepo'
import type { PermisoCirculacion } from '../repositories/permisosCirculacionRepo'
import type { PermisoCirculacionCreate, PermisoCirculacionUpdate } from '../schemas/permisoCirculacionSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getAll(): Promise<PermisoCirculacion[]> {
  return repo.findAll()
}

export async function create(data: PermisoCirculacionCreate): Promise<PermisoCirculacion> {
  return repo.create(data.zona_circulacion, data.fecha_expiracion)
}

export async function update(id: number, data: PermisoCirculacionUpdate): Promise<PermisoCirculacion> {
  const result = await repo.update(id, data.zona_circulacion, data.fecha_expiracion)
  if (!result) throw new NotFoundError('Permiso de circulación')
  return result
}

export async function remove(id: number): Promise<void> {
  const vehiculos = await repo.countVehiculos(id)
  if (vehiculos > 0) {
    throw new ConflictError(
      `Este permiso está asignado a ${vehiculos} vehículo(s) y no puede eliminarse`
    )
  }
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Permiso de circulación')
}

export async function assignVehiculos(id: number, vehiculoIds: number[]): Promise<void> {
  const permiso = await repo.findById(id)
  if (!permiso) throw new NotFoundError('Permiso de circulación')
  await repo.assignVehiculos(id, vehiculoIds)
}

export async function unassignVehiculo(id: number, vehiculoId: number): Promise<void> {
  const ok = await repo.unassignVehiculo(id, vehiculoId)
  if (!ok) throw new NotFoundError('Vehículo en este permiso')
}
