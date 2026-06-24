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
  num_factura: string | null
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
    },
  })
}
