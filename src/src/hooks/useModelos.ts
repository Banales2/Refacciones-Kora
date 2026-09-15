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
  // Desde cuándo se dejó de comprar unidades de este modelo, y por qué. Null =
  // se sigue usando. Un modelo descontinuado conserva todo —programa, garantías,
  // tipos de pieza— y las unidades que ya lo usan lo siguen mostrando; no se
  // borra nunca. No confundir con dar de baja una unidad, que es su `status`.
  descontinuado_en:     string | null
  descontinuado_motivo: string | null
  created_at:       string
  updated_at:       string
}

export interface ModeloPayload {
  marca:             string
  nombre:            string
  anio?:             string | null
  tipos_permitidos?: TipoVehiculo[]
}

// Por defecto solo los modelos que se siguen usando, que es lo que se ofrece al
// dar de alta una unidad. `incluirDescontinuados` es para la pantalla de
// modelos, que necesita verlos para poder revivirlos.
export function useModelos(incluirDescontinuados = false) {
  return useQuery({
    queryKey: ['modelos', incluirDescontinuados ? 'con-descontinuados' : 'en-uso'],
    queryFn: () => api.get<{ data: Modelo[] }>(
      incluirDescontinuados ? '/modelos?descontinuados=1' : '/modelos'),
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

// Un modelo no se borra: se descontinúa. Deja de ofrecerse al dar de alta
// unidades, pero su programa, sus garantías y sus tipos de pieza siguen ahí, y
// las unidades que ya lo usan lo siguen mostrando.
export function useDescontinuarModelo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, motivo }: { id: number; motivo?: string }) =>
      api.post<{ data: Modelo }>(`/modelos/${id}/descontinuar`, { motivo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modelos'] }),
  })
}

export function useRevivirModelo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.accion<{ data: Modelo }>(`/modelos/${id}/revivir`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modelos'] }),
  })
}
