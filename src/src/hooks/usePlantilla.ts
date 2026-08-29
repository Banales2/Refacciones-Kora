// Plantilla de requerimientos por modelo: mantenimientos periódicos (por km,
// meses o ambos) que se copian a cada vehículo del modelo como requerimientos
// propios. Se administra desde la página de Modelos.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export type TriggerMode   = 'km' | 'meses' | 'ambos'

export interface PlantillaRequerimiento {
  id:              number
  nombre:          string
  descripcion:     string | null
  categoria:       string | null
  intervalo_km:    number | null
  intervalo_meses: number | null
  trigger_mode:    TriggerMode
  activo:          boolean
  created_at:      string
  updated_at:      string
  modelo_id:       number
  /** Garantías del modelo que obligan a este servicio. Vacío = se pide siempre. */
  garantia_modelo_ids: number[]
}

export interface PlantillaPayload {
  nombre:          string
  descripcion?:    string | null
  categoria?:      string | null
  trigger_mode:    TriggerMode
  intervalo_km?:   number | null
  intervalo_meses?: number | null
  activo?:         boolean
  /** Ausente en una edición = no se tocan; [] = el servicio deja de colgar de una garantía. */
  garantia_modelo_ids?: number[]
}

export function usePlantillaModelo(modeloId: number) {
  return useQuery({
    queryKey: ['plantilla', modeloId],
    queryFn: () => api.get<{ data: PlantillaRequerimiento[] }>(`/modelos/${modeloId}/plantilla`),
  })
}

// Tocar una plantilla no se queda en el modelo: la API copia, sincroniza o borra
// el requerimiento correspondiente en TODOS los vehículos de ese modelo. Por eso
// se invalidan las claves completas de `requerimientos` y `pendientes` (sin id de
// vehículo, para que caigan las de todos) y no solo la plantilla. Sin esto, un
// requerimiento borrado en el modelo seguía apareciendo en la ficha del vehículo
// hasta recargar la página.
function invalidarPlantilla(qc: ReturnType<typeof useQueryClient>, modeloId: number) {
  qc.invalidateQueries({ queryKey: ['plantilla', modeloId] })
  qc.invalidateQueries({ queryKey: ['requerimientos'] })
  qc.invalidateQueries({ queryKey: ['pendientes'] })
  qc.invalidateQueries({ queryKey: ['requerimientos-categorias'] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
  // El vínculo con las garantías se materializa en cada vehículo al guardar la
  // plantilla, así que la lista de garantías de las unidades también cambia.
  qc.invalidateQueries({ queryKey: ['garantias-vehiculo'] })
}

export function useCreatePlantilla(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PlantillaPayload) =>
      api.post<{ data: PlantillaRequerimiento }>(`/modelos/${modeloId}/plantilla`, payload),
    onSuccess: () => invalidarPlantilla(qc, modeloId),
  })
}

export function useUpdatePlantilla(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<PlantillaPayload> }) =>
      api.put<{ data: PlantillaRequerimiento }>(`/plantilla/${id}`, payload),
    onSuccess: () => invalidarPlantilla(qc, modeloId),
  })
}

export function useDeletePlantilla(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/plantilla/${id}`),
    onSuccess: () => invalidarPlantilla(qc, modeloId),
  })
}
