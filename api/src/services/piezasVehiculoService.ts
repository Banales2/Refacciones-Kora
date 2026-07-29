import * as repo from '../repositories/piezasVehiculoRepo'
import type { PiezaDeVehiculo } from '../repositories/piezasVehiculoRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import * as refaccionesRepo from '../repositories/refaccionesRepo'
import * as tiposRepo from '../repositories/tiposPiezaRepo'
import { NotFoundError, ValidationError } from '../shared/errors'

export async function getByVehiculo(vehiculoId: number): Promise<PiezaDeVehiculo[]> {
  const vehiculo = await vehiculosRepo.findById(vehiculoId)
  if (!vehiculo) throw new NotFoundError('Vehículo')
  return repo.findByVehiculo(vehiculoId)
}

export async function setPieza(vehiculoId: number, tipoId: number, piezaId: number): Promise<void> {
  const vehiculo = await vehiculosRepo.findById(vehiculoId)
  if (!vehiculo) throw new NotFoundError('Vehículo')

  const tipo = await tiposRepo.findById(tipoId)
  if (!tipo) throw new NotFoundError('Tipo de pieza')

  if (!(await repo.vehiculoRequiereTipo(vehiculoId, tipoId))) {
    throw new ValidationError(`Este vehículo no requiere ${tipo.nombre}`)
  }

  const pieza = await refaccionesRepo.findById(piezaId)
  if (!pieza) throw new NotFoundError('Refacción')

  // La pieza tiene que ser de ese tipo: si no, la elección del vehículo no
  // responde a lo que el modelo pide.
  if (pieza.tipo_pieza_id !== tipoId) {
    throw new ValidationError(
      `La refacción ${pieza.numero_serie} no es de tipo ${tipo.nombre}. ` +
      'Ajusta el tipo de la refacción en el catálogo o elige otra.'
    )
  }

  await repo.setPieza(vehiculoId, tipoId, piezaId)
}

export async function removePieza(vehiculoId: number, tipoId: number): Promise<void> {
  const ok = await repo.removePieza(vehiculoId, tipoId)
  if (!ok) throw new NotFoundError('Pieza asignada a este vehículo')
}
