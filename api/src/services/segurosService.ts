import * as repo from '../repositories/segurosRepo'
import type { Seguro } from '../repositories/segurosRepo'
import type { SeguroCreate, SeguroUpdate, SeguroRenovar } from '../schemas/seguroSchema'
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors'

export async function getAll(): Promise<Seguro[]> {
  return repo.findAll()
}

export async function create(data: SeguroCreate): Promise<Seguro> {
  return repo.create(data.poliza, data.compania, data.fecha_expiracion)
}

export async function update(id: number, data: SeguroUpdate): Promise<Seguro> {
  const result = await repo.update(id, data.poliza, data.compania, data.fecha_expiracion)
  if (!result) throw new NotFoundError('Seguro')
  return result
}

/** Lo que quedó tras renovar, y cuántas unidades pasaron a la póliza nueva. */
export interface Renovacion {
  seguro:            Seguro
  /** La póliza que se renovó. Es la misma que `seguro` al extender. */
  anterior:          Seguro
  modo:              SeguroRenovar['modo']
  /** Cuántas unidades se movieron. Cero al extender: no se mueve ninguna. */
  vehiculos_movidos: number
}

/**
 * Renovar una póliza.
 *
 * Las dos maneras terminan en lo mismo —la flota queda cubierta hasta una fecha
 * posterior— pero no son la misma operación:
 *
 * - `extender` corre la fecha de la póliza que ya existe. No se crea nada y las
 *   unidades ni se enteran, porque siguen apuntando al mismo registro.
 * - `nueva_poliza` da de alta la póliza nueva y le pasa las unidades que cubría
 *   la anterior. La anterior NO se borra: es el registro de qué cubrió a la
 *   flota hasta esa fecha, y borrarlo dejaría los meses pasados sin explicación.
 *   Se queda sin unidades, así que se puede eliminar a mano si de verdad
 *   estorba.
 *
 * En los dos casos la fecha nueva tiene que ser posterior a la vigente: eso es
 * lo que significa renovar. Corregir una fecha mal capturada —o acortarla— se
 * sigue haciendo por la edición normal, que no pregunta nada.
 */
export async function renovar(id: number, data: SeguroRenovar): Promise<Renovacion> {
  const anterior = await repo.findById(id)
  if (!anterior) throw new NotFoundError('Seguro')

  if (data.fecha_expiracion <= anterior.fecha_expiracion) {
    throw new ValidationError(
      `La póliza vence el ${anterior.fecha_expiracion}: la renovación tiene que ` +
      'cubrir hasta una fecha posterior. Si lo que quieres es corregir la fecha, ' +
      'edita la póliza.'
    )
  }

  if (data.modo === 'extender') {
    const seguro = await repo.update(id, undefined, undefined, data.fecha_expiracion)
    if (!seguro) throw new NotFoundError('Seguro')
    return { seguro, anterior, modo: data.modo, vehiculos_movidos: 0 }
  }

  const compania = data.compania ?? anterior.compania
  // Misma póliza y misma compañía no es una póliza nueva: es la de siempre con
  // otra fecha, y para eso está el otro modo. Decirlo evita acabar con dos
  // registros idénticos y la flota repartida entre los dos.
  if (data.poliza === anterior.poliza && compania === anterior.compania) {
    throw new ConflictError(
      'Esa es la misma póliza con la misma compañía. Si la aseguradora solo ' +
      'prolongó la vigencia, usa "Extender la misma póliza".'
    )
  }

  const seguro = await repo.create(data.poliza, compania, data.fecha_expiracion)
  // Las unidades se mueven de golpe: `assignVehiculos` las reasigna desde la
  // póliza que tuvieran, así que la anterior queda vacía sola.
  const vehiculos = await repo.findVehiculoIds(id)
  if (vehiculos.length) await repo.assignVehiculos(seguro.id, vehiculos)

  return { seguro, anterior, modo: data.modo, vehiculos_movidos: vehiculos.length }
}

export async function remove(id: number): Promise<void> {
  const vehiculos = await repo.countVehiculos(id)
  if (vehiculos > 0) {
    throw new ConflictError(
      `Este seguro está asignado a ${vehiculos} vehículo(s) y no puede eliminarse`
    )
  }
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Seguro')
}

export async function assignVehiculos(id: number, vehiculoIds: number[]): Promise<void> {
  const seguro = await repo.findById(id)
  if (!seguro) throw new NotFoundError('Seguro')
  await repo.assignVehiculos(id, vehiculoIds)
}

export async function unassignVehiculo(id: number, vehiculoId: number): Promise<void> {
  const ok = await repo.unassignVehiculo(id, vehiculoId)
  if (!ok) throw new NotFoundError('Vehículo en este seguro')
}
