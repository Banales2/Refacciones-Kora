import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Sucursal { id: number; nombre: string }

export function useSucursales() {
  return useQuery({
    queryKey: ['sucursales'],
    queryFn: () => api.get<{ data: Sucursal[] }>('/sucursales'),
    staleTime: 10 * 60 * 1000,
  })
}
