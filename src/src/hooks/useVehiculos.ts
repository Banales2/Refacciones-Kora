import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export type TipoVehiculo = 'camion' | 'tractocamion' | 'caja_trailer' | 'utilitario'

export interface VehiculoRow {
  id:           number
  vehiculo:     string
  tipo:         TipoVehiculo
  modelo_id:    number
  marca:        string
  modelo:       string
  serie:        string
  status:       string | null
  kilometraje:  number | null
  combustible:  string | null
  ubicacion:    string | null
  sucursal_id:  number | null
  sucursal:     string | null
  tonelaje:     number | null
  tenencia:     string | null
  ruta_id:      number | null
  ruta:         string | null
  pies:         number | null
  fecha_compra: string | null
}

export interface VehiculoCreatePayload {
  tipo:          TipoVehiculo
  vehiculo:      string
  modelo_id:     number
  serie:         string
  combustible?:  string
  kilometraje?:  number
  status?:       string
  ubicacion?:    string | null
  sucursal_id?:  number
  tonelaje?:     number
  tenencia?:     string | null
  ruta_id?:      number
  pies?:         number
  fecha_compra?: string | null
}

export interface VehiculoUpdatePayload extends Omit<VehiculoCreatePayload, 'tipo'> {}

interface ListResponse {
  data:       VehiculoRow[]
  pagination: { page: number; pageSize: number; total: number }
}

export function useVehiculos(page = 1, search = '', tipo?: TipoVehiculo, modeloId?: number) {
  return useQuery({
    queryKey: ['vehiculos', page, search, tipo, modeloId],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page) })
      if (search)   qs.set('search',    search)
      if (tipo)     qs.set('tipo',      tipo)
      if (modeloId) qs.set('modelo_id', String(modeloId))
      return api.get<ListResponse>(`/vehiculos?${qs}`)
    },
  })
}

export function useVehiculo(id?: number) {
  return useQuery({
    queryKey: ['vehiculos', 'detalle', id],
    queryFn: () => api.get<{ data: VehiculoRow }>(`/vehiculos/${id}`),
    enabled: id !== undefined,
  })
}

export function useCreateVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: VehiculoCreatePayload) =>
      api.post<{ data: VehiculoRow }>('/vehiculos', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehiculos'] }),
  })
}

export function useUpdateVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: VehiculoUpdatePayload }) =>
      api.put<{ data: VehiculoRow }>(`/vehiculos/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehiculos'] }),
  })
}

export function useDeleteVehiculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/vehiculos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehiculos'] }),
  })
}
