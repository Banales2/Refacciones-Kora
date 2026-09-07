// Garantías: el catálogo por modelo y la garantía de cada unidad.
//
// Lo que hace que esto sirva de algo es la garantía marcada como `principal` en
// el modelo: mientras siga viva, la unidad sigue el programa de mantenimiento
// del fabricante; cuando se acaba, pasa al programa de después de la garantía.
// `programaVehiculoService` entra por aquí para resolverlo, y no tiene su
// propia versión de "ya se acabó".
import * as repo from '../repositories/garantiasRepo'
import * as modelosRepo from '../repositories/modelosRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import { NotFoundError, ValidationError } from '../shared/errors'
import { evaluarGarantia, type EstadoGarantia } from '../shared/garantias'
import { fechaMexico } from '../shared/fechaMexico'
import type {
  GarantiaModelo, GarantiaModeloCreate, GarantiaModeloUpdate,
  GarantiaVehiculo, GarantiaVehiculoCreate, GarantiaVehiculoUpdate,
} from '../repositories/garantiasRepo'

// ─── Catálogo del modelo ────────────────────────────────────────────────────

export async function getByModelo(modeloId: number): Promise<GarantiaModelo[]> {
  if (!(await modelosRepo.findById(modeloId))) throw new NotFoundError('Modelo')
  return repo.findByModelo(modeloId)
}

export async function createModelo(
  modeloId: number, data: Omit<GarantiaModeloCreate, 'modelo_id'>
): Promise<GarantiaModelo> {
  if (!(await modelosRepo.findById(modeloId))) throw new NotFoundError('Modelo')
  const creada = await repo.createModelo({ ...data, modelo_id: modeloId })
  // Solo una gobierna el programa: marcarla desmarca la que estuviera. Se hace
  // después del INSERT porque el índice único es filtrado y las dos en 1 a la
  // vez chocarían.
  if (creada.principal) await repo.setPrincipal(modeloId, creada.id)
  // Dar de alta una garantía en el modelo la baja a todas sus unidades.
  await repo.copyToVehicles(creada)
  return (await repo.findModeloById(creada.id))!
}

export async function updateModelo(
  id: number, data: GarantiaModeloUpdate
): Promise<GarantiaModelo> {
  // `principal` se aparta del UPDATE normal: apagarla y encenderla en la misma
  // sentencia chocaría con el índice único filtrado, así que va por su propia
  // transacción.
  const { principal, ...resto } = data
  const actualizada = await repo.updateModelo(id, resto)
  if (!actualizada) throw new NotFoundError('Garantía del modelo')
  if (principal !== undefined) {
    await repo.setPrincipal(actualizada.modelo_id, principal ? id : null)
  }
  await repo.syncLinked(actualizada)
  // Reactivarla vuelve a bajarla a las unidades que no la tienen.
  if (actualizada.activo) await repo.copyToVehicles(actualizada)
  return (await repo.findModeloById(id))!
}

export async function removeModelo(id: number): Promise<void> {
  const borrada = await repo.removeModelo(id)
  if (!borrada) throw new NotFoundError('Garantía del modelo')
}

// ─── Garantías de una unidad ────────────────────────────────────────────────

/** La garantía tal como se guarda, más lo que hay que calcular para leerla. */
export interface GarantiaVehiculoConEstado extends GarantiaVehiculo {
  estado: EstadoGarantia
}

function conEstado(g: GarantiaVehiculo, hoy: string): GarantiaVehiculoConEstado {
  return { ...g, estado: evaluarGarantia(g, g.kilometraje, hoy) }
}

export async function getByVehiculo(vehiculoId: number): Promise<GarantiaVehiculoConEstado[]> {
  if (!(await vehiculosRepo.findById(vehiculoId))) throw new NotFoundError('Vehículo')
  const hoy = fechaMexico()
  return (await repo.findByVehiculo(vehiculoId)).map((g) => conEstado(g, hoy))
}

// Al capturar una garantía a mano lo normal es que arranque cuando se compró la
// unidad; se prellena aquí y no en el formulario para que valga igual si la
// captura llega por la API.
export async function createVehiculo(
  vehiculoId: number, data: Omit<GarantiaVehiculoCreate, 'vehiculo_id'>
): Promise<GarantiaVehiculoConEstado> {
  const vehiculo = await vehiculosRepo.findById(vehiculoId)
  if (!vehiculo) throw new NotFoundError('Vehículo')
  const creada = await repo.createVehiculo({
    ...data,
    vehiculo_id:  vehiculoId,
    fecha_inicio: data.fecha_inicio ?? vehiculo.fecha_compra ?? null,
  })
  return conEstado(creada, fechaMexico())
}

export async function updateVehiculo(
  id: number, data: GarantiaVehiculoUpdate
): Promise<GarantiaVehiculoConEstado> {
  const actualizada = await repo.updateVehiculo(id, data)
  if (!actualizada) throw new NotFoundError('Garantía')
  return conEstado(actualizada, fechaMexico())
}

// La heredada del modelo no se borra por unidad: el catálogo dice qué trae ese
// modelo, y borrarla en una sola unidad la deja distinta sin dejar rastro de
// por qué. Si
// esa unidad la perdió, se cancela con su motivo, que además es el dato que
// sirve después ("se le cayó la garantía en marzo por no traerla a servicio").
export async function removeVehiculo(id: number): Promise<void> {
  const existe = await repo.findVehiculoGarantiaById(id)
  if (!existe) throw new NotFoundError('Garantía')
  if (existe.garantia_origen_id != null) {
    throw new ValidationError(
      'Esta garantía viene del modelo y no se puede eliminar de una sola unidad. ' +
      'Si esta unidad la perdió, cancélala indicando desde cuándo y por qué.'
    )
  }
  const borrada = await repo.removeVehiculo(id)
  if (!borrada) throw new NotFoundError('Garantía')
}
