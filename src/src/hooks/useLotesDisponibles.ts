import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface LoteDisponible {
  id:                  number
  pieza_id:            number
  numero_serie:        string
  descripcion:         string
  costo_unitario:      number
  cantidad_disponible: number
  fecha_compra:        string
}

export function useLotesDisponibles(enabled: boolean) {
  return useQuery({
    queryKey: ['lotes-disponibles'],
    queryFn: () => api.get<{ data: LoteDisponible[] }>('/lotes-disponibles'),
    enabled,
  })
}
