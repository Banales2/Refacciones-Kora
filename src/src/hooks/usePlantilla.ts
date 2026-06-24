import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export type TriggerMode   = 'km' | 'meses' | 'ambos'
export type TipoPlantilla = 'recurrente' | 'unica'

export interface PlantillaRequerimiento {
  id:              number
  nombre:          string
  descripcion:     string | null
  categoria:       string | null
  intervalo_km:    number | null
  intervalo_meses: number | null
  trigger_mode:    TriggerMode
  tipo:            TipoPlantilla
  activo:          boolean
  created_at:      string
  updated_at:      string
  modelo_id:       number
}

export interface PlantillaPayload {
  nombre:          string
  descripcion?:    string | null
  categoria?:      string | null
  trigger_mode:    TriggerMode
  tipo?:           TipoPlantilla
  intervalo_km?:   number | null
  intervalo_meses?: number | null
  activo?:         boolean
}

export function usePlantillaModelo(modeloId: number) {
  return useQuery({
    queryKey: ['plantilla', modeloId],
    queryFn: () => api.get<{ data: PlantillaRequerimiento[] }>(`/modelos/${modeloId}/plantilla`),
  })
}

export function useCreatePlantilla(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PlantillaPayload) =>
      api.post<{ data: PlantillaRequerimiento }>(`/modelos/${modeloId}/plantilla`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plantilla', modeloId] }),
  })
}

export function useUpdatePlantilla(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<PlantillaPayload> }) =>
      api.put<{ data: PlantillaRequerimiento }>(`/plantilla/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plantilla', modeloId] }),
  })
}

export function useDeletePlantilla(modeloId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/plantilla/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plantilla', modeloId] }),
  })
}
