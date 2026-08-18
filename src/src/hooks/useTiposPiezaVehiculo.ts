// Tipos de pieza propios de un vehículo: los que necesita esa unidad y su
// modelo no pide (p. ej. una unidad que lleva aceite de transmisión y el resto
// del modelo no). Se suman a los del modelo (useTiposPiezaModelo) y aparecen en
// la misma lista (usePiezasVehiculo). NO afecta el inventario.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useAddTiposPiezaVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vehiculoId, tipoIds, etiqueta }: {
      vehiculoId: number; tipoIds: number[]; etiqueta?: string
    }) =>
      api.post<void>(`/vehiculos/${vehiculoId}/tipos-pieza`, {
        tipo_pieza_ids: tipoIds, etiqueta: etiqueta ?? '',
      }),
    onSuccess: (_d, { vehiculoId }) =>
      qc.invalidateQueries({ queryKey: ['piezas-vehiculo', vehiculoId] }),
  })
}

// Cambiar el nombre de la posición de un renglón propio de la unidad. Arrastra
// la refacción montada y el historial, por eso se invalidan los dos.
export function useRenameEtiquetaVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vehiculoId, tipoId, etiqueta, etiquetaNueva }: {
      vehiculoId: number; tipoId: number; etiqueta: string; etiquetaNueva: string
    }) =>
      api.put<void>(`/vehiculos/${vehiculoId}/tipos-pieza/${tipoId}`, {
        etiqueta, etiqueta_nueva: etiquetaNueva,
      }),
    onSuccess: (_d, { vehiculoId }) => {
      qc.invalidateQueries({ queryKey: ['piezas-vehiculo', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['piezas-historial', vehiculoId] })
    },
  })
}

export function useRemoveTipoPiezaVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    // La etiqueta identifica CUÁL renglón del tipo se quita.
    mutationFn: ({ vehiculoId, tipoId, etiqueta }: {
      vehiculoId: number; tipoId: number; etiqueta?: string
    }) =>
      api.delete<void>(
        `/vehiculos/${vehiculoId}/tipos-pieza/${tipoId}?etiqueta=${encodeURIComponent(etiqueta ?? '')}`
      ),
    onSuccess: (_d, { vehiculoId }) =>
      qc.invalidateQueries({ queryKey: ['piezas-vehiculo', vehiculoId] }),
  })
}
