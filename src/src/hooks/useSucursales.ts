// Catálogo de sucursales; se asignan a camiones y montacargas, y sirven para
// agrupar la flota en las vistas y los reportes.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Sucursal {
  id:        number
  nombre:    string
  ubicacion: string
}

export interface SucursalPayload {
  nombre:    string
  ubicacion: string
}

export function useSucursales() {
  return useQuery({
    queryKey: ['sucursales'],
    queryFn: () => api.get<{ data: Sucursal[] }>('/sucursales'),
    staleTime: 10 * 60 * 1000,
  })
}

export function useCreateSucursal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SucursalPayload) =>
      api.post<{ data: Sucursal }>('/sucursales', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sucursales'] }),
  })
}

export function useUpdateSucursal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<SucursalPayload> }) =>
      api.put<{ data: Sucursal }>(`/sucursales/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sucursales'] }),
  })
}

export function useDeleteSucursal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/sucursales/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sucursales'] }),
  })
}
