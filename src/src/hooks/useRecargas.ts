// Recargas de combustible de un vehículo: cada una registra la gasolinera,
// el conductor, la fecha, los litros cargados y lo que costó.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Recarga {
  id:            number
  vehiculo_id:   number
  gasolinera_id: number
  conductor_id:  number
  fecha:         string
  litros:        number
  costo:         number
  gasolinera:    string
  ubicacion:     string
  conductor:     string
}

export interface RecargaPayload {
  gasolinera_id: number
  conductor_id:  number
  fecha:         string
  litros:        number
  costo:         number
}

export function useRecargas(vehiculoId: number) {
  return useQuery({
    queryKey: ['recargas', vehiculoId],
    queryFn: () => api.get<{ data: Recarga[] }>(`/vehiculos/${vehiculoId}/recargas`),
    enabled: vehiculoId > 0,
  })
}

export function useCreateRecarga(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: RecargaPayload) =>
      api.post<{ data: Recarga }>(`/vehiculos/${vehiculoId}/recargas`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recargas', vehiculoId] }),
  })
}

export function useUpdateRecarga(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<RecargaPayload> }) =>
      api.put<{ data: Recarga }>(`/recargas/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recargas', vehiculoId] }),
  })
}

export function useDeleteRecarga(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/recargas/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recargas', vehiculoId] }),
  })
}
