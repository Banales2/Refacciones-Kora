// Lotes de compra de una pieza: cada lote registra proveedor, factura, costo
// unitario y cantidades (inicial y disponible). El stock de una pieza es la
// suma de sus lotes; los mantenimientos descuentan de lotes específicos.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Lote {
  id: number
  pieza_id: number
  proveedor_id: number
  fecha_compra: string
  costo_unitario: number
  cantidad_inicial: number
  cantidad_disponible: number
  num_factura: string | null
  proveedor: string
  // Quién hizo la compra y quién la autorizó. El segundo lo pone la API con la
  // cuenta que registró el lote: no se manda ni se edita.
  comprado_por: string
  autorizado_por: string
}

interface LotesResponse {
  pieza: { id: number; numero_serie: string; descripcion: string }
  lotes: Lote[]
}

export interface LotePayload {
  proveedor_id: number
  fecha_compra: string
  costo_unitario: number
  cantidad_inicial: number
  num_factura: string
  comprado_por: string
}

export function useLotes(piezaId: number | null) {
  return useQuery({
    queryKey: ['lotes', piezaId],
    queryFn: () => api.get<LotesResponse>(`/piezas/${piezaId}/lotes`),
    enabled: piezaId !== null,
  })
}

export function useCreateLote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ piezaId, ...body }: { piezaId: number } & LotePayload) =>
      api.post<{ data: Lote }>(`/piezas/${piezaId}/lotes`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['refacciones'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
    },
  })
}

export function useUpdateLote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<LotePayload>) =>
      api.put<{ data: Lote }>(`/lotes/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['refacciones'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
    },
  })
}

export function useDeleteLote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/lotes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['refacciones'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
    },
  })
}
