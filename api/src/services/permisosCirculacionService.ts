import * as repo from '../repositories/permisosCirculacionRepo'
import type { PermisoCirculacion } from '../repositories/permisosCirculacionRepo'
import type { PermisoCirculacionCreate, PermisoCirculacionUpdate } from '../schemas/permisoCirculacionSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getAll(): Promise<PermisoCirculacion[]> {
  return repo.findAll()
}

export async function create(data: PermisoCirculacionCreate): Promise<PermisoCirculacion> {
  if (await repo.existsMismaZonaYFecha(data.zona_circulacion, data.fecha_emision)) {
    throw new ConflictError('Ya existe un permiso de esa zona emitido en esa fecha')
  }
  return repo.create(data.zona_circulacion, data.fecha_emision, data.fecha_expiracion)
}

export async function update(id: number, data: PermisoCirculacionUpdate): Promise<PermisoCirculacion> {
  const actual = await repo.findById(id)
  if (!actual) throw new NotFoundError('Permiso de circulación')

  // Valores efectivos tras el update (los no enviados conservan el actual).
  const zona    = data.zona_circulacion ?? actual.zona_circulacion
  const emision = data.fecha_emision !== undefined ? data.fecha_emision : actual.fecha_emision
  if (emision && await repo.existsMismaZonaYFecha(zona, emision, id)) {
    throw new ConflictError('Ya existe un permiso de esa zona emitido en esa fecha')
  }

  const result = await repo.update(id, data.zona_circulacion, data.fecha_emision, data.fecha_expiracion)
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
