import * as repo from '../repositories/recargasRepo'
import type { RecargaConGasolinera } from '../repositories/recargasRepo'
import type { RecargaCreate, RecargaUpdate } from '../schemas/recargaSchema'
import { NotFoundError, ValidationError, ConflictError } from '../shared/errors'

// El vale tiene que existir, haber sido emitido para el mismo vehículo que se
// está recargando (si no, la recarga quedaría amarrada al vale de otra unidad)
// y no haberse usado antes: cada vale sirve para una sola recarga.
async function validarVale(
  valeId: number, vehiculoId: number, recargaId?: number
): Promise<void> {
  const vehiculoDelVale = await repo.valeVehiculo(valeId)
  if (vehiculoDelVale === null) throw new NotFoundError('Vale')
  if (vehiculoDelVale !== vehiculoId) {
    throw new ValidationError('El vale corresponde a otro vehículo')
  }
  if (await repo.valeUsado(valeId, recargaId)) {
    throw new ConflictError('Ese vale ya se usó en otra recarga')
  }
}

export async function getByVehiculo(vehiculoId: number): Promise<RecargaConGasolinera[]> {
  return repo.findByVehiculo(vehiculoId)
}

export async function create(vehiculoId: number, data: RecargaCreate): Promise<RecargaConGasolinera> {
  if (!(await repo.vehiculoExists(vehiculoId))) throw new NotFoundError('Vehículo')
  await validarVale(data.vale_id, vehiculoId)
  return repo.create(vehiculoId, data)
}

export async function update(id: number, data: RecargaUpdate): Promise<RecargaConGasolinera> {
  if (data.vale_id !== undefined) {
    const actual = await repo.findById(id)
    if (!actual) throw new NotFoundError('Recarga')
    await validarVale(data.vale_id, actual.vehiculo_id, id)
  }
  const result = await repo.update(id, data)
  if (!result) throw new NotFoundError('Recarga')
  return result
}

export async function remove(id: number): Promise<void> {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Recarga')
}
