// Mantenimientos realizados a un vehículo: fecha, técnico, costo de mano de
// obra, kilometraje y los requerimientos que satisface. El costo de piezas
// (piezas_total) viene del detalle asociado (useDetalleMtto).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Mantenimiento {
  id:               number
  vehiculo_id:      number
  fecha:            string | null
  tipo:             string | null
  tecnico:          string | null
  costo:            number
  km_actual:        number
  observaciones:    string | null
  requerimiento_ids: number[]
  piezas_total:     number
}

export interface MantenimientoPayload {
  fecha:              string
  tipo?:              string | null
  tecnico?:           string | null
  costo?:             number
  km_actual?:         number
  observaciones?:     string | null
  requerimiento_ids:  number[]
}

export function useMantenimientos(vehiculoId: number) {
  return useQuery({
    queryKey: ['mantenimientos', vehiculoId],
    queryFn: () => api.get<{ data: Mantenimiento[] }>(`/vehiculos/${vehiculoId}/mantenimientos`),
    enabled: vehiculoId > 0,
  })
}

export function useCreateMantenimiento(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: MantenimientoPayload) =>
      api.post<{ data: Mantenimiento }>(`/vehiculos/${vehiculoId}/mantenimientos`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mantenimientos',  vehiculoId] })
      qc.invalidateQueries({ queryKey: ['requerimientos', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUpdateMantenimiento(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<MantenimientoPayload> }) =>
      api.put<{ data: Mantenimiento }>(`/mantenimientos/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mantenimientos',  vehiculoId] })
      qc.invalidateQueries({ queryKey: ['requerimientos', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useDeleteMantenimiento(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/mantenimientos/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mantenimientos', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
