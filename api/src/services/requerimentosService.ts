import * as repo from '../repositories/requerimentosRepo'
import * as garantiasService from './garantiasService'
import { ConflictError, NotFoundError } from '../shared/errors'
import type {
  RequerimientoCreate, RequerimientoUpdate, RequerimientoExclusivo,
} from '../repositories/requerimentosRepo'
import { ensureDailySync } from './dashboardService'

// Un requerimiento puede existir por una garantía: es el servicio que el
// fabricante exige para no perderla. Cuando todas las garantías que lo sostienen
// se acaban, el servicio deja de pedirse — y eso se calcula, no se guarda, así
// que viaja resuelto en cada renglón.
export interface RequerimientoConGarantias extends RequerimientoExclusivo {
  garantia_ids: number[]
  /** Todas sus garantías se vencieron o se cancelaron: ya no hay que hacerlo. */
  silenciado_por_garantia: boolean
}

export async function getByVehiculo(vehiculoId: number): Promise<RequerimientoConGarantias[]> {
  // "Una vez al día, cada vez que se use la app": consultar requerimientos ya
  // dispara el snapshot diario del dashboard si todavía no ha corrido hoy.
  await ensureDailySync()
  const [items, garantias] = await Promise.all([
    repo.findByVehiculo(vehiculoId),
    garantiasService.getGarantiasPorRequerimiento(vehiculoId),
  ])
  return items.map((r) => {
    const g = garantias.get(r.id)
    return {
      ...r,
      garantia_ids: g?.ids ?? [],
      silenciado_por_garantia: g?.silenciado ?? false,
    }
  })
}

export async function getCategorias() {
  return repo.findCategorias()
}

export async function create(
  vehiculoId: number,
  data: Omit<RequerimientoCreate, 'vehiculo_id'>,
  garantiaIds?: number[],
) {
  const created = await repo.create({ ...data, vehiculo_id: vehiculoId })
  if (garantiaIds?.length) {
    await garantiasService.setVinculosRequerimiento(created.id, vehiculoId, garantiaIds)
  }
  return created
}

export async function update(id: number, data: RequerimientoUpdate, garantiaIds?: number[]) {
  const updated = await repo.update(id, data)
  if (!updated) throw new NotFoundError('Requerimiento')
  // Solo cuando el campo viaja: un PATCH que no lo trae deja las garantías
  // atadas como estaban.
  if (garantiaIds !== undefined) {
    await garantiasService.setVinculosRequerimiento(id, updated.vehiculo_id, garantiaIds)
  }
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
