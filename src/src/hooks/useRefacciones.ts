import { useQuery } from '@tanstack/react-query'
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

export function useRefacciones(page = 1, search = '') {
  return useQuery({
    queryKey: ['refacciones', page, search],
    queryFn: () =>
      api.get<ListResponse>(
        `/refacciones?page=${page}${search ? `&search=${encodeURIComponent(search)}` : ''}`
      ),
  })
}
