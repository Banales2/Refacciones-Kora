import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Modelo {
  id:     number
  marca:  string
  nombre: string
}

export interface ModeloPayload {
  marca:  string
  nombre: string
}

export function useModelos() {
  return useQuery({
    queryKey: ['modelos'],
    queryFn: () => api.get<{ data: Modelo[] }>('/modelos'),
    staleTime: 10 * 60 * 1000,
  })
}

export function useCreateModelo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ModeloPayload) =>
      api.post<{ data: Modelo }>('/modelos', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modelos'] }),
  })
}

export function useUpdateModelo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<ModeloPayload> }) =>
      api.put<{ data: Modelo }>(`/modelos/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modelos'] }),
  })
}

export function useDeleteModelo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/modelos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modelos'] }),
  })
}
