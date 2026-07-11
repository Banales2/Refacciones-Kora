// Flota de vehículos: búsqueda paginada con filtros por tipo/modelo, detalle
// individual y CRUD. Según el tipo, un vehículo pertenece a una ruta
// (tractocamión, caja de trailer) o a una sucursal (camión, montacargas).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export type TipoVehiculo = 'camion' | 'tractocamion' | 'caja_trailer' | 'utilitario' | 'montacargas'

export interface VehiculoRow {
  id:           number
  tipo:         TipoVehiculo
  modelo_id:    number
  marca:        string
  modelo:       string
  serie:        string
  placas:       string | null
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
  modelo_id:     number
  serie:         string
  placas?:       string | null
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

export type VehiculoUpdatePayload = Partial<Omit<VehiculoCreatePayload, 'tipo'>>

interface ListResponse {
  data:       VehiculoRow[]
  pagination: { page: number; pageSize: number; total: number }
}

export function vehiculoLabel(v: Pick<VehiculoRow, 'marca' | 'modelo' | 'serie'>): string {
  return `${v.marca} ${v.modelo} — ${v.serie}`
}

export function useVehiculos(
  page = 1, search = '', tipo?: TipoVehiculo, modeloId?: number, pageSize?: number, enabled = true
) {
  return useQuery({
    queryKey: ['vehiculos', page, search, tipo, modeloId, pageSize],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page) })
      if (search)   qs.set('search',    search)
      if (tipo)     qs.set('tipo',      tipo)
      if (modeloId) qs.set('modelo_id', String(modeloId))
      if (pageSize) qs.set('pageSize',  String(pageSize))
      return api.get<ListResponse>(`/vehiculos?${qs}`)
    },
    enabled,
  })
}

export function useVehiculo(id?: number) {
  return useQuery({
    queryKey: ['vehiculos', 'detalle', id],
    queryFn: () => api.get<{ data: VehiculoRow }>(`/vehiculos/${id}`),
    enabled: id !== undefined,
  })
}

// Se pide bajo demanda (al exportar el PDF) para traer el inventario completo
// sin importar la búsqueda o página activa en pantalla.
export function fetchTodosLosVehiculos() {
  return api.get<ListResponse>('/vehiculos?page=1&pageSize=100')
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
