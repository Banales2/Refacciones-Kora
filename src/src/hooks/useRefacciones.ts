// Catálogo e inventario de piezas (refacciones): búsqueda paginada por número
// de serie o descripción y CRUD. El stock (cantidad_total) es la suma de los
// lotes de compra de cada pieza (useLotes).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Pieza {
  id: number
  numero_serie: string
  descripcion: string
  categoria: string
  cantidad_total: number
}

interface ListResponse {
  data: Pieza[]
  pagination: { page: number; pageSize: number; total: number }
}

export type SearchBy = 'all' | 'numero_serie' | 'descripcion'

export function useRefacciones(
  page = 1, search = '', searchBy: SearchBy = 'all', pageSize?: number, enabled = true
) {
  return useQuery({
    queryKey: ['refacciones', page, search, searchBy, pageSize],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page) })
      if (search) { qs.set('search', search); qs.set('searchBy', searchBy) }
      if (pageSize) qs.set('pageSize', String(pageSize))
      return api.get<ListResponse>(`/refacciones?${qs}`)
    },
    enabled,
  })
}

// Se pide bajo demanda (al exportar el PDF) para traer el inventario completo
// sin importar la búsqueda o página activa en pantalla.
export function fetchTodasLasPiezas() {
  return api.get<ListResponse>('/refacciones?page=1&pageSize=100')
}

export function useCreateRefaccion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { numero_serie: string; descripcion: string; categoria: string }) =>
      api.post<{ data: Pieza }>('/refacciones', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['refacciones'] }),
  })
}

export function useUpdateRefaccion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; numero_serie?: string; descripcion?: string; categoria?: string }) =>
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
