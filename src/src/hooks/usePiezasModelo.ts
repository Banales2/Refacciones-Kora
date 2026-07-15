// Piezas específicas que necesita un modelo (relación n-n informativa: filtro,
// batería o aceite exclusivo). NO afecta el inventario; solo indica el tipo de
// pieza que requiere el modelo.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface PiezaDeModelo {
  id:           number
  numero_serie: string
  descripcion:  string
  categoria:    string
}

export function usePiezasModelo(modeloId?: number) {
  return useQuery({
    queryKey: ['piezas-modelo', modeloId],
    queryFn: () => api.get<{ data: PiezaDeModelo[] }>(`/modelos/${modeloId}/piezas`),
    enabled: modeloId !== undefined,
  })
}

export function useAddPiezasModelo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ modeloId, piezaIds }: { modeloId: number; piezaIds: number[] }) =>
      api.post<void>(`/modelos/${modeloId}/piezas`, { pieza_ids: piezaIds }),
    onSuccess: (_d, { modeloId }) =>
      qc.invalidateQueries({ queryKey: ['piezas-modelo', modeloId] }),
  })
}

export function useRemovePiezaModelo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ modeloId, piezaId }: { modeloId: number; piezaId: number }) =>
      api.delete<void>(`/modelos/${modeloId}/piezas/${piezaId}`),
    onSuccess: (_d, { modeloId }) =>
      qc.invalidateQueries({ queryKey: ['piezas-modelo', modeloId] }),
  })
}
