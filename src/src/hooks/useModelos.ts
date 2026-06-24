import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Modelo {
  id:     number
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
