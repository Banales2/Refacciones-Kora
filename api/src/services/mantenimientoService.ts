import * as repo from '../repositories/mantenimientoRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import { NotFoundError } from '../shared/errors'

export async function getByVehiculo(vehiculoId: number) {
  return repo.findByVehiculo(vehiculoId)
}

// Registrar un mantenimiento es la ocasión en que se lee el odómetro, así que
// el km reportado pasa a ser el kilometraje del vehículo (avanzarKilometraje
// ignora los tipos sin odómetro y no permite retrocesos).
export async function create(vehiculoId: number, data: Omit<repo.MantenimientoCreate, 'vehiculo_id'>) {
  const mantenimiento = await repo.create({ ...data, vehiculo_id: vehiculoId })
  if (data.km_actual && data.km_actual > 0) {
    await vehiculosRepo.avanzarKilometraje(vehiculoId, data.km_actual)
  }
  return mantenimiento
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
