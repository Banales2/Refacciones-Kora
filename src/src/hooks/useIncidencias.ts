// Incidencias: algo reportado de un vehículo que hay que atender una vez. Junto
// con los requerimientos preventivos son las dos caras de un "pendiente"; la
// mitad de sus campos (nombre, descripción, categoría, status, vehículo) vive en
// la tabla padre, pero la API los devuelve planos.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export type Severidad       = 'superficial' | 'moderada' | 'grave'
export type StatusIncidencia = 'activo' | 'completado' | 'pausado' | 'cancelado'

export interface Incidencia {
  id:            number
  vehiculo_id:   number
  origen:        'incidencia'
  nombre:        string
  descripcion:   string | null
  categoria:     string | null
  status:        StatusIncidencia
  created_at:    string
  updated_at:    string
  reportado_por: string | null
  severidad:     Severidad
  fecha:         string
  hora:          string | null
  ubicacion:     string | null
}

export interface IncidenciaConVehiculo extends Incidencia {
  vehiculo_nombre: string
  vehiculo_tipo:   string
}

export interface IncidenciaPayload {
  nombre:         string
  descripcion:    string
  categoria?:     string | null
  status?:        StatusIncidencia
  reportado_por?: string | null
  severidad:      Severidad
  fecha:          string
  hora?:          string | null
  ubicacion?:     string | null
}

export function useIncidencias() {
  return useQuery({
    queryKey: ['incidencias'],
    queryFn: () => api.get<{ data: IncidenciaConVehiculo[] }>('/incidencias'),
  })
}

export function useIncidenciasVehiculo(vehiculoId: number) {
  return useQuery({
    queryKey: ['incidencias', vehiculoId],
    queryFn: () => api.get<{ data: Incidencia[] }>(`/vehiculos/${vehiculoId}/incidencias`),
  })
}

// Cualquier alta o cambio mueve tres listas: la de la flota, la del vehículo y
// la de pendientes que alimenta los selectores de mantenimiento y agenda.
function invalidar(qc: ReturnType<typeof useQueryClient>, vehiculoId: number) {
  qc.invalidateQueries({ queryKey: ['incidencias'] })
  qc.invalidateQueries({ queryKey: ['incidencias', vehiculoId] })
  qc.invalidateQueries({ queryKey: ['pendientes', vehiculoId] })
  qc.invalidateQueries({ queryKey: ['requerimientos-categorias'] })
}

export function useCreateIncidencia(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: IncidenciaPayload) =>
      api.post<{ data: Incidencia }>(`/vehiculos/${vehiculoId}/incidencias`, payload),
    onSuccess: () => invalidar(qc, vehiculoId),
  })
}

export function useUpdateIncidencia(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<IncidenciaPayload> }) =>
      api.put<{ data: Incidencia }>(`/incidencias/${id}`, payload),
    onSuccess: () => invalidar(qc, vehiculoId),
  })
}

export function useDeleteIncidencia(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/incidencias/${id}`),
    onSuccess: () => invalidar(qc, vehiculoId),
  })
}
