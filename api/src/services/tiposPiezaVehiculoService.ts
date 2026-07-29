import * as repo from '../repositories/tiposPiezaVehiculoRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import * as tiposRepo from '../repositories/tiposPiezaRepo'
import { NotFoundError } from '../shared/errors'

export async function addTipos(vehiculoId: number, tipoIds: number[]): Promise<void> {
  const vehiculo = await vehiculosRepo.findById(vehiculoId)
  if (!vehiculo) throw new NotFoundError('Vehículo')

  for (const tipoId of tipoIds) {
    if (!(await tiposRepo.findById(tipoId))) throw new NotFoundError('Tipo de pieza')
  }

  await repo.addTipos(vehiculoId, tipoIds)
}

export async function removeTipo(vehiculoId: number, tipoId: number): Promise<void> {
  const ok = await repo.removeTipo(vehiculoId, tipoId)
  // Falla también cuando el tipo viene del modelo: no está en la lista propia
  // del vehículo, y quitarlo se hace desde el modelo.
  if (!ok) throw new NotFoundError('Tipo de pieza propio de este vehículo')
}
