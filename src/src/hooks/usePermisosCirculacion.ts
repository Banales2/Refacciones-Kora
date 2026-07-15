// Catálogo de permisos de circulación (zona de circulación y fecha de
// expiración); se referencian desde cada vehículo. Varios vehículos pueden
// compartir el mismo permiso, y no es obligatorio que un vehículo tenga uno.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface PermisoCirculacion {
  id:               number
  zona_circulacion: string
  fecha_emision:    string | null
  fecha_expiracion: string
}

export interface PermisoCirculacionPayload {
  zona_circulacion: string
  fecha_emision:    string
  fecha_expiracion: string
}

export function usePermisosCirculacion() {
  return useQuery({
    queryKey: ['permisos-circulacion'],
    queryFn: () => api.get<{ data: PermisoCirculacion[] }>('/permisos-circulacion'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreatePermisoCirculacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: PermisoCirculacionPayload) =>
      api.post<{ data: PermisoCirculacion }>('/permisos-circulacion', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['permisos-circulacion'] }),
  })
}

export function useUpdatePermisoCirculacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<PermisoCirculacionPayload> }) =>
      api.put<{ data: PermisoCirculacion }>(`/permisos-circulacion/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['permisos-circulacion'] })
      // Los datos del permiso vienen embebidos en cada vehículo.
      qc.invalidateQueries({ queryKey: ['vehiculos'] })
    },
  })
}

export function useDeletePermisoCirculacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/permisos-circulacion/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['permisos-circulacion'] }),
  })
}

// Asigna uno o más vehículos a este permiso (los mueve desde su permiso previo).
export function useAssignVehiculosPermiso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, vehiculoIds }: { id: number; vehiculoIds: number[] }) =>
      api.post<void>(`/permisos-circulacion/${id}/vehiculos`, { vehiculo_ids: vehiculoIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehiculos'] }),
  })
}

// Quita un vehículo de este permiso (deja su permiso_id en null).
export function useUnassignVehiculoPermiso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, vehiculoId }: { id: number; vehiculoId: number }) =>
      api.delete<void>(`/permisos-circulacion/${id}/vehiculos/${vehiculoId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehiculos'] }),
  })
}
