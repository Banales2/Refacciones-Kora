import * as repo from '../repositories/incidenciasRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import { NotFoundError, ValidationError } from '../shared/errors'
import { itemsDe, itemPorClave } from '../shared/chequeoItems'
import type { TipoVehiculo } from '../schemas/vehiculoSchema'
import type { IncidenciaCreate, IncidenciaUpdate } from '../repositories/incidenciasRepo'

/**
 * Que la pregunta del chequeo exista y le toque a esta unidad.
 *
 * Mismo criterio que `prepararItems` del chequeo: una caja de tráiler no
 * contesta por sus faros, así que tampoco puede tener una incidencia colgada de
 * esa pregunta. Sin esto, una clave mal puesta ligaría la incidencia a algo que
 * ningún chequeo va a volver a preguntar, y se quedaría abierta para siempre
 * sin que nadie la enganche ni la cierre.
 */
async function validarClaveChequeo(vehiculoId: number, clave: string) {
  const vehiculo = await vehiculosRepo.findById(vehiculoId)
  if (!vehiculo) throw new NotFoundError('Vehículo')
  const permitidas = itemsDe(vehiculo.tipo as TipoVehiculo)
  if (!permitidas.some((i) => i.clave === clave)) {
    const existe = itemPorClave(clave)
    throw new ValidationError(
      existe
        ? `La pregunta "${existe.label}" no aplica a este tipo de unidad`
        : `Pregunta desconocida: ${clave}`
    )
  }
}

export async function getByVehiculo(vehiculoId: number) {
  return repo.findByVehiculo(vehiculoId)
}

export async function getAll() {
  return repo.findAllConVehiculo()
}

export async function getReportadores() {
  return repo.findReportadores()
}

export async function create(
  vehiculoId: number,
  data: Omit<IncidenciaCreate, 'vehiculo_id'>,
  autorizadoPor: string,
) {
  if (data.clave_chequeo) await validarClaveChequeo(vehiculoId, data.clave_chequeo)
  return repo.create({ ...data, vehiculo_id: vehiculoId }, autorizadoPor)
}

export async function update(id: number, data: IncidenciaUpdate) {
  if (data.clave_chequeo) {
    // El vehículo no se edita, así que se valida contra el que ya tiene.
    const actual = await repo.findById(id)
    if (!actual) throw new NotFoundError('Incidencia')
    await validarClaveChequeo(actual.vehiculo_id, data.clave_chequeo)
  }
  const updated = await repo.update(id, data)
  if (!updated) throw new NotFoundError('Incidencia')
  return updated
}

