import * as repo from '../repositories/valesGasolinaRepo'
import type { ValeGasolina } from '../repositories/valesGasolinaRepo'
import type { ValeGasolinaCreate, ValeGasolinaUpdate } from '../schemas/valeGasolinaSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

// Chofer y vehículo se validan aquí para devolver un 404 con mensaje claro en
// vez de dejar que reviente la restricción de llave foránea con un 500.
async function validarReferencias(
  conductorId?: number, vehiculoId?: number
): Promise<void> {
  if (conductorId !== undefined && !(await repo.conductorExists(conductorId))) {
    throw new NotFoundError('Chofer')
  }
  if (vehiculoId !== undefined && !(await repo.vehiculoExists(vehiculoId))) {
    throw new NotFoundError('Vehículo')
  }
}

export async function getAll(): Promise<ValeGasolina[]> {
  return repo.findAll()
}

export async function create(data: ValeGasolinaCreate, creadoPor: string): Promise<ValeGasolina> {
  await validarReferencias(data.conductor_id, data.vehiculo_id)
  // El folio también lo protege un índice único; se revisa aquí para contestar
  // con un mensaje que diga qué pasó en vez de un error de base de datos.
  if (await repo.existsFolio(data.folio)) {
    throw new ConflictError(`Ya existe un vale con el folio ${data.folio}`)
  }
  return repo.create(data, creadoPor)
}

export async function update(id: number, data: ValeGasolinaUpdate): Promise<ValeGasolina> {
  await validarReferencias(data.conductor_id, data.vehiculo_id)
  if (data.folio !== undefined && await repo.existsFolio(data.folio, id)) {
    throw new ConflictError(`Ya existe un vale con el folio ${data.folio}`)
  }
  const result = await repo.update(id, data)
  if (!result) throw new NotFoundError('Vale')
  return result
}

export async function remove(id: number): Promise<void> {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Vale')
}
