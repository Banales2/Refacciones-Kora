import * as repo from '../repositories/requerimentosRepo'
import { ConflictError, NotFoundError } from '../shared/errors'
import type { RequerimientoCreate, RequerimientoUpdate } from '../repositories/requerimentosRepo'
import { ensureDailySync } from './dashboardService'

export async function getByVehiculo(vehiculoId: number) {
  // "Una vez al día, cada vez que se use la app": consultar requerimientos ya
  // dispara el snapshot diario del dashboard si todavía no ha corrido hoy.
  await ensureDailySync()
  return repo.findByVehiculo(vehiculoId)
}

export async function getCategorias() {
  return repo.findCategorias()
}

export async function create(vehiculoId: number, data: Omit<RequerimientoCreate, 'vehiculo_id'>) {
  return repo.create({ ...data, vehiculo_id: vehiculoId })
}

export async function update(id: number, data: RequerimientoUpdate) {
  const updated = await repo.update(id, data)
  if (!updated) throw new NotFoundError('Requerimiento')
  await ensureDailySync()
  return updated
}

// Lo heredado de la plantilla del modelo no se borra por vehículo: la plantilla
// dice qué le toca a *todas* las unidades de ese modelo, y borrarlo en una sola
// deja al vehículo distinto del modelo sin que quede rastro de por qué. Si a esa
// unidad no le aplica, se pausa. Sólo lo exclusivo del vehículo —lo que alguien
// dio de alta ahí a mano— se puede eliminar.
export async function remove(id: number) {
  const existe = await repo.findById(id)
  if (!existe) throw new NotFoundError('Requerimiento')
  if (existe.plantilla_origen_id != null) {
    throw new ConflictError(
      'Este requerimiento viene de la plantilla del modelo y no se puede eliminar. ' +
      'Si no aplica a este vehículo, edítalo y ponlo como pausado.'
    )
  }

  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Requerimiento')
}
