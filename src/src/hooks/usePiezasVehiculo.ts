// Qué refacción usa un vehículo para cada tipo de pieza que necesita. La lista
// trae los tipos que pide su modelo más los propios de la unidad
// (useTiposPiezaVehiculo); pieza_id viene null mientras no se haya elegido,
// para que se vea lo que falta capturar.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface PiezaDeVehiculo {
  tipo_pieza_id: number
  tipo_nombre:   string
  pieza_id:      number | null
  numero_serie:  string | null
  descripcion:   string | null
  // 'modelo': lo pide el modelo y se quita desde allá. 'vehiculo': es propio de
  // esta unidad y se quita aquí.
  origen:        'modelo' | 'vehiculo'
}

export function usePiezasVehiculo(vehiculoId?: number) {
  return useQuery({
    queryKey: ['piezas-vehiculo', vehiculoId],
    queryFn: () => api.get<{ data: PiezaDeVehiculo[] }>(`/vehiculos/${vehiculoId}/piezas`),
    enabled: vehiculoId !== undefined,
  })
}

export function useSetPiezaVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vehiculoId, tipoId, piezaId }: { vehiculoId: number; tipoId: number; piezaId: number }) =>
      api.put<void>(`/vehiculos/${vehiculoId}/piezas/${tipoId}`, { pieza_id: piezaId }),
    onSuccess: (_d, { vehiculoId }) =>
      qc.invalidateQueries({ queryKey: ['piezas-vehiculo', vehiculoId] }),
  })
}

export function useRemovePiezaVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vehiculoId, tipoId }: { vehiculoId: number; tipoId: number }) =>
      api.delete<void>(`/vehiculos/${vehiculoId}/piezas/${tipoId}`),
    onSuccess: (_d, { vehiculoId }) =>
      qc.invalidateQueries({ queryKey: ['piezas-vehiculo', vehiculoId] }),
  })
}
