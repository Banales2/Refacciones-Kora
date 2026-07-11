// Requerimientos de mantenimiento propios de un vehículo: tareas recurrentes
// o únicas que vencen por kilometraje, por tiempo o por ambos. Pueden nacer
// de la plantilla del modelo (plantilla_origen_id) o crearse a mano.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export type TriggerMode = 'km' | 'meses' | 'ambos'
export type TipoReq     = 'recurrente' | 'unica'
export type StatusReq   = 'activo' | 'completado' | 'pausado' | 'cancelado'

export interface RequerimientoExclusivo {
  id:                  number
  nombre:              string
  descripcion:         string | null
  categoria:           string | null
  intervalo_km:        number | null
  intervalo_meses:     number | null
  trigger_mode:        TriggerMode
  tipo:                TipoReq
  status:              StatusReq
  created_at:          string
  updated_at:          string
  vehiculo_id:         number
  plantilla_origen_id: number | null
  fecha_inicio:        string | null
  km_inicio:           number | null
  fecha_reporte:       string | null
}

export interface RequerimientoPayload {
  nombre:           string
  descripcion?:     string | null
  categoria?:       string | null
  trigger_mode:     TriggerMode
  tipo?:            TipoReq
  intervalo_km?:    number | null
  intervalo_meses?: number | null
  status?:          StatusReq
  fecha_inicio?:    string | null
  km_inicio?:       number | null
  fecha_reporte?:   string | null
}

export function useRequerimientos(vehiculoId: number) {
  return useQuery({
    queryKey: ['requerimientos', vehiculoId],
    queryFn: () => api.get<{ data: RequerimientoExclusivo[] }>(`/vehiculos/${vehiculoId}/requerimientos`),
  })
}

export function useCreateRequerimiento(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: RequerimientoPayload) =>
      api.post<{ data: RequerimientoExclusivo }>(`/vehiculos/${vehiculoId}/requerimientos`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requerimientos', vehiculoId] }),
  })
}

export function useUpdateRequerimiento(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<RequerimientoPayload> }) =>
      api.put<{ data: RequerimientoExclusivo }>(`/requerimientos/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requerimientos', vehiculoId] }),
  })
}

export function useDeleteRequerimiento(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/requerimientos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requerimientos', vehiculoId] }),
  })
}
