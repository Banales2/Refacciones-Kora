// Catálogo de marcas/modelos de vehículos. Cada modelo puede tener una
// programa de mantenimiento (usePrograma) que siguen sus vehículos.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { TipoVehiculo } from './useVehiculos'

export interface Modelo {
  id:               number
  marca:            string
  nombre:           string
  // Año-versión del modelo ("2018" o "2018-1"). Distingue dos modelos de igual
  // marca/nombre pero año distinto, y también dos versiones del mismo año que
  // salieron con piezas distintas. Null en modelos antiguos.
  anio:             string | null
  // Tipos de vehículo que este modelo puede generar. Vacío = sin restricción.
  tipos_permitidos: TipoVehiculo[]
  // Desde cuándo dejó de ofrecerse el modelo al dar de alta unidades, y por
  // qué. Null = vigente. Un modelo dado de baja conserva todo —programa,
  // garantías, tipos de pieza— y los vehículos que ya lo usan lo siguen
  // mostrando; no se borra nunca.
  baja_en:          string | null
  baja_motivo:      string | null
  created_at:       string
  updated_at:       string
}

export interface ModeloPayload {
  marca:             string
  nombre:            string
  anio?:             string | null
  tipos_permitidos?: TipoVehiculo[]
}

// Por defecto solo los modelos vigentes, que es lo que se ofrece al dar de alta
// una unidad. `incluirBajas` es para la pantalla de modelos, que necesita verlos
// para poder reactivarlos.
export function useModelos(incluirBajas = false) {
  return useQuery({
    queryKey: ['modelos', incluirBajas ? 'con-bajas' : 'vigentes'],
    queryFn: () => api.get<{ data: Modelo[] }>(incluirBajas ? '/modelos?bajas=1' : '/modelos'),
    staleTime: 10 * 60 * 1000,
  })
}

export function useCreateModelo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ModeloPayload) =>
      api.post<{ data: Modelo }>('/modelos', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modelos'] }),
  })
}

export function useUpdateModelo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<ModeloPayload> }) =>
      api.put<{ data: Modelo }>(`/modelos/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modelos'] }),
  })
}

// Un modelo no se borra: se da de baja. Deja de ofrecerse al dar de alta
// unidades, pero su programa, sus garantías y sus tipos de pieza siguen ahí, y
// los vehículos que ya lo usan lo siguen mostrando.
export function useBajaModelo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, motivo }: { id: number; motivo?: string }) =>
      api.post<{ data: Modelo }>(`/modelos/${id}/baja`, { motivo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modelos'] }),
  })
}

export function useReactivarModelo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ data: Modelo }>(`/modelos/${id}/baja`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modelos'] }),
  })
}
