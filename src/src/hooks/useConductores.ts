// Catálogo de conductores; se referencian desde las recargas de combustible
// de cada vehículo.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Conductor {
  id:     number
  nombre: string
}

export interface ConductorPayload {
  nombre: string
}

export function useConductores() {
  return useQuery({
    queryKey: ['conductores'],
    queryFn: () => api.get<{ data: Conductor[] }>('/conductores'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateConductor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ConductorPayload) =>
      api.post<{ data: Conductor }>('/conductores', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conductores'] }),
  })
}

export function useUpdateConductor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ConductorPayload }) =>
      api.put<{ data: Conductor }>(`/conductores/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conductores'] })
      // El nombre del conductor viene embebido en cada recarga.
      qc.invalidateQueries({ queryKey: ['recargas'] })
    },
  })
}

export function useDeleteConductor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/conductores/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conductores'] }),
  })
}
