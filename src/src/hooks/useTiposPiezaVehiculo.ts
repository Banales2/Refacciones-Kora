// Tipos de pieza propios de un vehículo: los que necesita esa unidad y su
// modelo no pide (p. ej. una unidad que lleva aceite de transmisión y el resto
// del modelo no). Se suman a los del modelo (useTiposPiezaModelo) y aparecen en
// la misma lista (usePiezasVehiculo). NO afecta el inventario.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useAddTiposPiezaVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vehiculoId, tipoIds }: { vehiculoId: number; tipoIds: number[] }) =>
      api.post<void>(`/vehiculos/${vehiculoId}/tipos-pieza`, { tipo_pieza_ids: tipoIds }),
    onSuccess: (_d, { vehiculoId }) =>
      qc.invalidateQueries({ queryKey: ['piezas-vehiculo', vehiculoId] }),
  })
}

export function useRemoveTipoPiezaVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vehiculoId, tipoId }: { vehiculoId: number; tipoId: number }) =>
      api.delete<void>(`/vehiculos/${vehiculoId}/tipos-pieza/${tipoId}`),
    onSuccess: (_d, { vehiculoId }) =>
      qc.invalidateQueries({ queryKey: ['piezas-vehiculo', vehiculoId] }),
  })
}
