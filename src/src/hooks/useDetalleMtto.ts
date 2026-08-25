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
  /** Tipo de la refacción: dice en qué renglones del vehículo puede montarse. */
  tipo_pieza_id:    number | null
  numero_serie:     string
  descripcion:      string
  /** Lo que queda de ese lote en la sucursal de la que salió este consumo. */
  lote_disponible:  number
  // De qué sucursal salió. Null en los consumos anteriores al inventario por
  // sucursal que además pertenecen a un lote sin sucursal de recepción.
  sucursal_id:      number | null
  sucursal:         string | null
  /** Cuántas de estas piezas ya se montaron en la unidad. */
  montadas:         number
}

interface DetalleMttoResponse {
  mantenimiento: Mantenimiento
  detalles:      DetalleMttoPieza[]
}

export interface DetalleMttoPayload {
  lote_id:         number
  // De qué sucursal se descuenta. Obligatoria al crear; al editar no se manda,
  // porque el consumo se corrige donde se registró.
  sucursal_id?:    number
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

// Registra de golpe las piezas capturadas al dar de alta un mantenimiento. Van
// en serie (no en paralelo) porque cada una descuenta stock de su lote y el
// backend valida la existencia disponible en cada alta.
export function useCreateDetallesMtto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ mantenimientoId, piezas }: { mantenimientoId: number; piezas: DetalleMttoPayload[] }) => {
      for (const pieza of piezas) {
        await api.post<{ data: DetalleMttoPieza }>(`/mantenimientos/${mantenimientoId}/detalle`, pieza)
      }
    },
    onSettled: (_data, _err, { mantenimientoId }) => {
      // Incluso si una pieza falla a medias, las anteriores sí se guardaron:
      // se refresca igual para que la pantalla refleje el estado real.
      qc.invalidateQueries({ queryKey: ['detalle-mtto', mantenimientoId] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
      qc.invalidateQueries({ queryKey: ['mantenimientos'] })
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
