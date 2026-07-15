// Catálogo de seguros (póliza, compañía y fecha de expiración); se referencian
// desde cada vehículo. Muchos vehículos pueden compartir el mismo seguro, pero
// un vehículo nunca tiene dos seguros a la vez.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Seguro {
  id:               number
  poliza:           string
  compania:         string
  fecha_expiracion: string
}

export interface SeguroPayload {
  poliza:           string
  compania:         string
  fecha_expiracion: string
}

export function useSeguros() {
  return useQuery({
    queryKey: ['seguros'],
    queryFn: () => api.get<{ data: Seguro[] }>('/seguros'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateSeguro() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SeguroPayload) =>
      api.post<{ data: Seguro }>('/seguros', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seguros'] }),
  })
}

export function useUpdateSeguro() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<SeguroPayload> }) =>
      api.put<{ data: Seguro }>(`/seguros/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seguros'] })
      // Los datos del seguro vienen embebidos en cada vehículo.
      qc.invalidateQueries({ queryKey: ['vehiculos'] })
    },
  })
}

export function useDeleteSeguro() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/seguros/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seguros'] }),
  })
}

// Asigna uno o más vehículos a este seguro (los mueve desde su seguro previo).
export function useAssignVehiculosSeguro() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, vehiculoIds }: { id: number; vehiculoIds: number[] }) =>
      api.post<void>(`/seguros/${id}/vehiculos`, { vehiculo_ids: vehiculoIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehiculos'] }),
  })
}

// Quita un vehículo de este seguro (deja su seguro_id en null).
export function useUnassignVehiculoSeguro() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, vehiculoId }: { id: number; vehiculoId: number }) =>
      api.delete<void>(`/seguros/${id}/vehiculos/${vehiculoId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehiculos'] }),
  })
}
