import * as repo from '../repositories/recargasRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
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

// Cargar gasolina es, igual que un mantenimiento, una ocasión en que se lee el
// odómetro: el kilometraje reportado pasa a ser el del vehículo.
// `avanzarKilometraje` solo sube (una recarga capturada tarde, con un km menor
// al ya registrado, no hace retroceder el odómetro) e ignora los tipos que no
// llevan. Al frontend se le avisa antes de guardar: ver ConfirmarAvanceKm.
export async function create(vehiculoId: number, data: RecargaCreate): Promise<RecargaConGasolinera> {
  if (!(await repo.vehiculoExists(vehiculoId))) throw new NotFoundError('Vehículo')
  await validarVale(data.vale_id, vehiculoId)
  const recarga = await repo.create(vehiculoId, data)
  if (data.kilometraje > 0) {
    await vehiculosRepo.avanzarKilometraje(vehiculoId, data.kilometraje)
  }
  return recarga
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
