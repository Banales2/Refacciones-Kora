import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Ruta { id: number; nombre: string }

export function useRutas() {
  return useQuery({
    queryKey: ['rutas'],
    queryFn: () => api.get<{ data: Ruta[] }>('/rutas'),
    staleTime: 10 * 60 * 1000,
  })
}
