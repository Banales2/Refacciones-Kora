// Catálogo de sucursales; se asignan a camiones y montacargas, y sirven para
// agrupar la flota en las vistas y los reportes.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CamposArchivado } from './useArchivado'

export interface Sucursal extends CamposArchivado {
  id:        number
  nombre:    string
  ubicacion: string
}

export interface SucursalPayload {
  nombre:    string
  ubicacion: string
}

// Por defecto solo lo que está en uso. `incluirArchivados` es para la pantalla
// del catálogo, que necesita verlos para poder restaurarlos.
export function useSucursales(incluirArchivados = false) {
  return useQuery({
    queryKey: ['sucursales', incluirArchivados ? 'con-archivados' : 'en-uso'],
    queryFn: () => api.get<{ data: Sucursal[] }>(
      incluirArchivados ? '/sucursales?archivados=1' : '/sucursales'),
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

