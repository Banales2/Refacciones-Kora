import * as repo from '../repositories/mantenimientoRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import { NotFoundError } from '../shared/errors'

export async function getByVehiculo(vehiculoId: number) {
  return repo.findByVehiculo(vehiculoId)
}

export async function getAll() {
  return repo.findAll()
}

// Registrar un mantenimiento es la ocasión en que se lee el odómetro, así que
// el km reportado pasa a ser el kilometraje del vehículo (avanzarKilometraje
// ignora los tipos sin odómetro y no permite retrocesos).
//
// `capturadoPor` es quien teclea, y se guarda por lo mismo que en el lote: si la
// factura del taller descubre que la mano de obra estaba mal capturada, hay que
// poder contestar a quién hay que enseñarle. Ver la migración 046.
export async function create(
  vehiculoId: number,
  data: Omit<repo.MantenimientoCreate, 'vehiculo_id'>,
  capturadoPor: string | null = null,
) {
  const mantenimiento = await repo.create({ ...data, vehiculo_id: vehiculoId }, capturadoPor)
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

