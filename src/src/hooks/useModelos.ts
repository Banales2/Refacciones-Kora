// Catálogo de marcas/modelos de vehículos. Cada modelo puede tener una
// plantilla de requerimientos (usePlantilla) que se aplica a sus vehículos.
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
  created_at:       string
  updated_at:       string
}

export interface ModeloPayload {
  marca:             string
  nombre:            string
  anio?:             string | null
  tipos_permitidos?: TipoVehiculo[]
}

export function useModelos() {
  return useQuery({
    queryKey: ['modelos'],
    queryFn: () => api.get<{ data: Modelo[] }>('/modelos'),
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

export function useDeleteModelo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/modelos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modelos'] }),
  })
}
