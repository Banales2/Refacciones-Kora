// Tipos de pieza que necesita un modelo (relación n-n informativa): el modelo
// dice que requiere un filtro de aire, no cuál. La pieza concreta la decide cada
// vehículo (usePiezasVehiculo). NO afecta el inventario.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface TipoPiezaDeModelo {
  id:     number
  nombre: string
  // Posición que ocupa esa pieza en la unidad ("delantero", "trasero"): es lo
  // que permite pedir el mismo tipo dos veces. '' = va una sola vez.
  etiqueta: string
}

export function useTiposPiezaModelo(modeloId?: number) {
  return useQuery({
    queryKey: ['tipos-pieza-modelo', modeloId],
    queryFn: () => api.get<{ data: TipoPiezaDeModelo[] }>(`/modelos/${modeloId}/tipos-pieza`),
    enabled: modeloId !== undefined,
  })
}

export function useAddTiposPiezaModelo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ modeloId, tipoIds, etiqueta }: {
      modeloId: number; tipoIds: number[]; etiqueta?: string
    }) =>
      api.post<void>(`/modelos/${modeloId}/tipos-pieza`, {
        tipo_pieza_ids: tipoIds, etiqueta: etiqueta ?? '',
      }),
    onSuccess: (_d, { modeloId }) => {
      qc.invalidateQueries({ queryKey: ['tipos-pieza-modelo', modeloId] })
      // Los vehículos de este modelo ahora piden un tipo más.
      qc.invalidateQueries({ queryKey: ['piezas-vehiculo'] })
    },
  })
}

export function useRemoveTipoPiezaModelo() {
  const qc = useQueryClient()
  return useMutation({
    // La etiqueta identifica CUÁL renglón del tipo se quita: sin ella se
    // borraría el que va sin etiqueta, no el que el usuario tocó.
    mutationFn: ({ modeloId, tipoId, etiqueta }: {
      modeloId: number; tipoId: number; etiqueta?: string
    }) =>
      api.delete<void>(
        `/modelos/${modeloId}/tipos-pieza/${tipoId}?etiqueta=${encodeURIComponent(etiqueta ?? '')}`
      ),
    onSuccess: (_d, { modeloId }) => {
      qc.invalidateQueries({ queryKey: ['tipos-pieza-modelo', modeloId] })
      // Quitar el tipo borra también la pieza que los vehículos habían elegido.
      qc.invalidateQueries({ queryKey: ['piezas-vehiculo'] })
    },
  })
}
