import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Ruta {
  id:        number
  nombre:    string
  ubicacion: string
}

export interface RutaPayload {
  nombre:    string
  ubicacion: string
}

export function useRutas() {
  return useQuery({
    queryKey: ['rutas'],
    queryFn: () => api.get<{ data: Ruta[] }>('/rutas'),
    staleTime: 10 * 60 * 1000,
  })
}

export function useCreateRuta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: RutaPayload) =>
      api.post<{ data: Ruta }>('/rutas', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rutas'] }),
  })
}

export function useUpdateRuta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<RutaPayload> }) =>
      api.put<{ data: Ruta }>(`/rutas/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rutas'] }),
  })
}

export function useDeleteRuta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/rutas/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rutas'] }),
  })
}
