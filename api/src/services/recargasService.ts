import * as repo from '../repositories/recargasRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import type { RecargaConGasolinera, RecargaConVehiculo } from '../repositories/recargasRepo'
import type { Alcance } from '../shared/alcance'
import type { RecargaCreate, RecargaEmergencia, RecargaUpdate } from '../schemas/recargaSchema'
import { AppError, NotFoundError, ValidationError, ConflictError } from '../shared/errors'

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
  if (await repo.valeArchivado(valeId)) {
    throw new ConflictError(
      'Ese vale se dio por perdido y está archivado. Si apareció, restáuralo en ' +
      'Vales de gasolina y vuelve a intentarlo.'
    )
  }
}

export async function getAll(alcance: Alcance): Promise<RecargaConVehiculo[]> {
  return repo.findAll(alcance)
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

// La recarga de emergencia no lleva vale ni avanza el odómetro: no hay
// kilometraje que tomar.
export async function createEmergencia(
  vehiculoId: number, data: RecargaEmergencia
): Promise<RecargaConGasolinera> {
  if (!(await repo.vehiculoExists(vehiculoId))) throw new NotFoundError('Vehículo')
  return repo.createEmergencia(vehiculoId, data)
}

// `esAdmin`: las de emergencia solo las registra el admin, y corregirlas
// también es suyo; si no, un editor podría inflar después el costo de una
// carga que nadie respalda con vale.
export async function update(
  id: number, data: RecargaUpdate, esAdmin: boolean
): Promise<RecargaConGasolinera> {
  const actual = await repo.findById(id)
  if (!actual) throw new NotFoundError('Recarga')

  if (actual.emergencia) {
    if (!esAdmin) {
      throw new AppError('Solo un admin puede corregir una recarga de emergencia', 403, 'FORBIDDEN')
    }
    // Ponerle gasolinera o vale la volvería una recarga normal a medias; el
    // CHECK de la tabla lo rechazaría con un error ilegible.
    if (data.gasolinera_id !== undefined || data.vale_id !== undefined || data.kilometraje !== undefined) {
      throw new ValidationError('Una recarga de emergencia no lleva gasolinera, vale ni kilometraje')
    }
  }

  if (data.vale_id !== undefined) {
    await validarVale(data.vale_id, actual.vehiculo_id, id)
  }
  const result = await repo.update(id, data)
  if (!result) throw new NotFoundError('Recarga')
  return result
}

