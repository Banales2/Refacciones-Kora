import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Lote {
  id: number
  fecha_compra: string
  costo_unitario: number
  cantidad_inicial: number
  cantidad_disponible: number
  num_factura: string | null
  proveedor: string
}

interface LotesResponse {
  pieza: { id: number; numero_serie: string; descripcion: string }
  lotes: Lote[]
}

export function useLotes(piezaId: number | null) {
  return useQuery({
    queryKey: ['lotes', piezaId],
    queryFn: () => api.get<LotesResponse>(`/piezas/${piezaId}/lotes`),
    enabled: piezaId !== null,
  })
}
