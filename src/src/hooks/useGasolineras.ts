// Catálogo de gasolineras (nombre + ubicación); se referencian desde las
// recargas de combustible de cada vehículo.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Gasolinera {
  id:        number
  nombre:    string
  ubicacion: string
}

export interface GasolineraPayload {
  nombre:    string
  ubicacion: string
}

export function useGasolineras() {
  return useQuery({
    queryKey: ['gasolineras'],
    queryFn: () => api.get<{ data: Gasolinera[] }>('/gasolineras'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateGasolinera() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: GasolineraPayload) =>
      api.post<{ data: Gasolinera }>('/gasolineras', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gasolineras'] }),
  })
}

export function useUpdateGasolinera() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: GasolineraPayload }) =>
      api.put<{ data: Gasolinera }>(`/gasolineras/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gasolineras'] })
      // El nombre de la gasolinera viene embebido en cada recarga.
      qc.invalidateQueries({ queryKey: ['recargas'] })
    },
  })
}

export function useDeleteGasolinera() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/gasolineras/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gasolineras'] }),
  })
}
