// Detalle de un mantenimiento: las piezas usadas, cada una descontada de un
// lote de compra específico (lote_id) con su cantidad y costo unitario.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Mantenimiento } from './useMantenimientos'

export interface DetalleMttoPieza {
  id:               number
  mantenimiento_id: number
  lote_id:          number
  cantidad:         number
  costo_unitario:   number
  pieza_id:         number
  numero_serie:     string
  descripcion:      string
  lote_disponible:  number
}

interface DetalleMttoResponse {
  mantenimiento: Mantenimiento
  detalles:      DetalleMttoPieza[]
}

export interface DetalleMttoPayload {
  lote_id:         number
  cantidad:        number
  costo_unitario?: number
}

export function useDetalleMtto(mantenimientoId: number | null) {
  return useQuery({
    queryKey: ['detalle-mtto', mantenimientoId],
    queryFn: () => api.get<DetalleMttoResponse>(`/mantenimientos/${mantenimientoId}/detalle`),
    enabled: mantenimientoId !== null,
  })
}

export function useCreateDetalleMtto(mantenimientoId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: DetalleMttoPayload) =>
      api.post<{ data: DetalleMttoPieza }>(`/mantenimientos/${mantenimientoId}/detalle`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['detalle-mtto', mantenimientoId] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
    },
  })
}

export function useUpdateDetalleMtto(mantenimientoId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: number } & Partial<DetalleMttoPayload>) =>
      api.put<{ data: DetalleMttoPieza }>(`/detalle-mtto/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['detalle-mtto', mantenimientoId] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
    },
  })
}

export function useDeleteDetalleMtto(mantenimientoId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/detalle-mtto/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['detalle-mtto', mantenimientoId] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
    },
  })
}
