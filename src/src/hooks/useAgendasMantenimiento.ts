// Agendas de mantenimiento programado: citas futuras de taller por vehículo,
// con su ciclo de vida (pendiente → completada, que genera el mantenimiento
// real, o cancelada). Alimenta el Calendario y la pestaña del vehículo.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Mantenimiento, MantenimientoPayload } from './useMantenimientos'

export type AgendaStatus = 'pendiente' | 'completada' | 'cancelada'

export interface AgendaMantenimiento {
  id:                number
  vehiculo_id:       number
  fecha_inicio:      string
  fecha_fin:         string
  tipo:              string | null
  tecnico:           string | null
  observaciones:     string | null
  status:            AgendaStatus
  mantenimiento_id:  number | null
  requerimiento_ids: number[]
  created_at:        string
  updated_at:        string
}

export interface AgendaConVehiculo extends AgendaMantenimiento {
  vehiculo_nombre: string
  vehiculo_tipo:   string
}

export interface AgendaMantenimientoPayload {
  fecha_inicio:       string
  fecha_fin:          string
  tipo?:              string | null
  tecnico?:           string | null
  observaciones?:     string | null
  requerimiento_ids?: number[]
}

export function useAgendasMantenimiento(vehiculoId: number) {
  return useQuery({
    queryKey: ['agendas-mantenimiento', vehiculoId],
    queryFn: () => api.get<{ data: AgendaMantenimiento[] }>(`/vehiculos/${vehiculoId}/agendas-mantenimiento`),
    enabled: vehiculoId > 0,
  })
}

export function useAgendasCalendario() {
  return useQuery({
    queryKey: ['dashboard', 'agendas-calendario'],
    queryFn: () => api.get<{ data: AgendaConVehiculo[] }>('/dashboard/agendas-calendario'),
  })
}

export function useCreateAgenda(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: AgendaMantenimientoPayload) =>
      api.post<{ data: AgendaMantenimiento }>(`/vehiculos/${vehiculoId}/agendas-mantenimiento`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agendas-mantenimiento', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUpdateAgenda(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<AgendaMantenimientoPayload> }) =>
      api.put<{ data: AgendaMantenimiento }>(`/agendas-mantenimiento/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agendas-mantenimiento', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useCancelarAgenda(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<{ data: AgendaMantenimiento }>(`/agendas-mantenimiento/${id}/cancelar`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agendas-mantenimiento', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useDeleteAgenda(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/agendas-mantenimiento/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agendas-mantenimiento', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useCompletarAgenda(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: MantenimientoPayload }) =>
      api.post<{ data: Mantenimiento }>(`/agendas-mantenimiento/${id}/completar`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agendas-mantenimiento', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['mantenimientos', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['requerimientos', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      // Completar la agenda registra un mantenimiento, que avanza el odómetro.
      qc.invalidateQueries({ queryKey: ['vehiculos'] })
    },
  })
}
