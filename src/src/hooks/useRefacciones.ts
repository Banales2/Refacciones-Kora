import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Pieza {
  id: number
  numero_serie: string
  descripcion: string
  cantidad_total: number
}

interface ListResponse {
  data: Pieza[]
  pagination: { page: number; pageSize: number; total: number }
}

export type SearchBy = 'all' | 'numero_serie' | 'descripcion'

export function useRefacciones(page = 1, search = '', searchBy: SearchBy = 'all') {
  return useQuery({
    queryKey: ['refacciones', page, search, searchBy],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page) })
      if (search) { qs.set('search', search); qs.set('searchBy', searchBy) }
      return api.get<ListResponse>(`/refacciones?${qs}`)
    },
  })
}

export function useCreateRefaccion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { numero_serie: string; descripcion: string }) =>
      api.post<{ data: Pieza }>('/refacciones', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['refacciones'] }),
  })
}

export function useUpdateRefaccion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; numero_serie?: string; descripcion?: string }) =>
      api.put<{ data: Pieza }>(`/refacciones/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['refacciones'] }),
  })
}

export function useDeleteRefaccion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/refacciones/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['refacciones'] }),
  })
}
