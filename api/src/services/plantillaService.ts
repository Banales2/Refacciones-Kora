import * as repo from '../repositories/plantillaRepo'
import * as garantiasRepo from '../repositories/garantiasRepo'
import * as garantiasService from './garantiasService'
import { NotFoundError } from '../shared/errors'
import type {
  PlantillaCreate, PlantillaUpdate, PlantillaRequerimiento,
} from '../repositories/plantillaRepo'

// Cada renglón de la plantilla dice además por qué garantía del modelo existe
// (si es que existe por alguna). Se devuelve junto con la plantilla para no
// obligar a la pantalla a pedirlo aparte renglón por renglón.
export interface PlantillaConGarantias extends PlantillaRequerimiento {
  garantia_modelo_ids: number[]
}

export async function getByModelo(modeloId: number): Promise<PlantillaConGarantias[]> {
  const [plantilla, vinculos] = await Promise.all([
    repo.findByModelo(modeloId),
    garantiasRepo.findGarantiasDePlantillasDeModelo(modeloId),
  ])
  const porPlantilla = new Map<number, number[]>()
  for (const v of vinculos) {
    const lista = porPlantilla.get(v.plantilla_id)
    if (lista) lista.push(v.garantia_modelo_id)
    else porPlantilla.set(v.plantilla_id, [v.garantia_modelo_id])
  }
  return plantilla.map((p) => ({ ...p, garantia_modelo_ids: porPlantilla.get(p.id) ?? [] }))
}

export async function create(
  modeloId: number,
  data: Omit<PlantillaCreate, 'modelo_id'>,
  garantiaModeloIds?: number[],
) {
  const created = await repo.create({ ...data, modelo_id: modeloId })
  await repo.copyToVehicles(created)
  if (garantiaModeloIds?.length) {
    await garantiasService.setGarantiasDePlantilla(created.id, modeloId, garantiaModeloIds)
  }
  return created
}

export async function update(
  id: number, data: PlantillaUpdate, garantiaModeloIds?: number[]
) {
  const updated = await repo.update(id, data)
  if (!updated) throw new NotFoundError('Requerimiento de plantilla')
  await repo.syncLinked(updated)
  // Solo cuando el campo viaja: un PATCH que no lo trae no debe desatar las
  // garantías que ya estaban declaradas.
  if (garantiaModeloIds !== undefined) {
    await garantiasService.setGarantiasDePlantilla(id, updated.modelo_id, garantiaModeloIds)
  }
  return updated
}

export async function remove(id: number) {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Requerimiento de plantilla')
}
