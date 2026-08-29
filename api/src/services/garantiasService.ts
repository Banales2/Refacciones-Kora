// Garantías: catálogo por modelo, garantía de cada unidad y el vínculo con los
// requerimientos preventivos que existen por ellas.
//
// La regla que hace que todo esto sirva de algo vive al final del archivo: un
// requerimiento atado a garantías deja de pedirse cuando todas se acabaron. El
// tablero y la ficha del vehículo la consultan desde aquí para no tener cada
// uno su propia versión de "ya no aplica".
import * as repo from '../repositories/garantiasRepo'
import * as modelosRepo from '../repositories/modelosRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import { NotFoundError, ValidationError } from '../shared/errors'
import { evaluarGarantia, cubiertoPorGarantiaVencida, type EstadoGarantia } from '../shared/garantias'
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
  // Igual que la plantilla de requerimientos: dar de alta una garantía en el
  // modelo la baja a todas sus unidades, y en seguida se atan los servicios que
  // ya decían existir por ella.
  await repo.copyToVehicles(creada)
  await repo.sincronizarVinculosDesdePlantilla({ garantiaModeloId: creada.id })
  return creada
}

export async function updateModelo(
  id: number, data: GarantiaModeloUpdate
): Promise<GarantiaModelo> {
  const actualizada = await repo.updateModelo(id, data)
  if (!actualizada) throw new NotFoundError('Garantía del modelo')
  await repo.syncLinked(actualizada)
  // Reactivarla vuelve a bajarla a las unidades que no la tienen.
  if (actualizada.activo) {
    await repo.copyToVehicles(actualizada)
    await repo.sincronizarVinculosDesdePlantilla({ garantiaModeloId: actualizada.id })
  }
  return actualizada
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

// La heredada del modelo no se borra por unidad, por lo mismo que un
// requerimiento de plantilla tampoco: el catálogo dice qué trae ese modelo, y
// borrarla en una sola unidad la deja distinta sin dejar rastro de por qué. Si
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

// ─── Vínculo con los requerimientos ─────────────────────────────────────────

export async function setVinculosRequerimiento(
  requerimientoId: number, vehiculoId: number, garantiaIds: number[]
): Promise<void> {
  const unicos = [...new Set(garantiaIds)]
  // Atar un requerimiento a la garantía de otra unidad silenciaría un servicio
  // por algo que no le pasó a ese vehículo.
  if (unicos.length && await repo.contarGarantiasDeVehiculo(vehiculoId, unicos) !== unicos.length) {
    throw new ValidationError('Alguna de las garantías no pertenece a este vehículo')
  }
  await repo.setVinculosRequerimiento(requerimientoId, unicos)
}

export async function setGarantiasDePlantilla(
  plantillaId: number, modeloId: number, garantiaModeloIds: number[]
): Promise<void> {
  const unicos = [...new Set(garantiaModeloIds)]
  if (unicos.length && await repo.contarGarantiasDeModelo(modeloId, unicos) !== unicos.length) {
    throw new ValidationError('Alguna de las garantías no pertenece a este modelo')
  }
  await repo.setGarantiasDePlantilla(plantillaId, unicos)
  // El cambio en el catálogo baja a las unidades en los dos sentidos: se atan
  // los vínculos nuevos y se sueltan los que dejaron de estar declarados.
  await repo.sincronizarVinculosDesdePlantilla({ plantillaId })
  await repo.limpiarVinculosHuerfanos(plantillaId)
}

export const getGarantiasDePlantilla = repo.findGarantiasDePlantilla
export const getGarantiasDePlantillasDeModelo = repo.findGarantiasDePlantillasDeModelo

/** Las garantías de cada requerimiento de un vehículo, con su vigencia. */
export interface GarantiasDeRequerimiento {
  ids:        number[]
  /** True cuando todas están vencidas o canceladas: el servicio ya no aplica. */
  silenciado: boolean
}

export async function getGarantiasPorRequerimiento(
  vehiculoId: number
): Promise<Map<number, GarantiasDeRequerimiento>> {
  const [vinculos, garantias] = await Promise.all([
    repo.findVinculosPorVehiculo(vehiculoId),
    repo.findByVehiculo(vehiculoId),
  ])
  const hoy = fechaMexico()
  const estadoPorGarantia = new Map<number, EstadoGarantia>(
    garantias.map((g) => [g.id, evaluarGarantia(g, g.kilometraje, hoy)])
  )

  const porRequerimiento = new Map<number, EstadoGarantia[]>()
  const idsPorRequerimiento = new Map<number, number[]>()
  for (const v of vinculos) {
    const estado = estadoPorGarantia.get(v.garantia_vehiculo_id)
    if (!estado) continue
    if (!porRequerimiento.has(v.requerimiento_id)) {
      porRequerimiento.set(v.requerimiento_id, [])
      idsPorRequerimiento.set(v.requerimiento_id, [])
    }
    porRequerimiento.get(v.requerimiento_id)!.push(estado)
    idsPorRequerimiento.get(v.requerimiento_id)!.push(v.garantia_vehiculo_id)
  }

  const salida = new Map<number, GarantiasDeRequerimiento>()
  for (const [reqId, estados] of porRequerimiento) {
    salida.set(reqId, {
      ids: idsPorRequerimiento.get(reqId)!,
      silenciado: cubiertoPorGarantiaVencida(estados),
    })
  }
  return salida
}

/**
 * Los requerimientos de toda la flota que ya no hay que pedir porque las
 * garantías que los exigían se acabaron. El tablero los descuenta de vencidos y
 * por-vencer, y el calendario deja de agendarlos.
 */
export async function idsSilenciadosPorGarantia(): Promise<Set<number>> {
  const vinculos = await repo.findVinculosFleet()
  const hoy = fechaMexico()

  const porRequerimiento = new Map<number, EstadoGarantia[]>()
  for (const v of vinculos) {
    const estado = evaluarGarantia(v, v.kilometraje, hoy)
    const lista = porRequerimiento.get(v.requerimiento_id)
    if (lista) lista.push(estado)
    else porRequerimiento.set(v.requerimiento_id, [estado])
  }

  const silenciados = new Set<number>()
  for (const [reqId, estados] of porRequerimiento) {
    if (cubiertoPorGarantiaVencida(estados)) silenciados.add(reqId)
  }
  return silenciados
}
