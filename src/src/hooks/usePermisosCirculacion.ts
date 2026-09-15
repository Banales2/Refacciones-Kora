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
  /**
   * Cuándo se dio por terminado. Null = sigue contando (avisa al vencer). Con
   * fecha = archivado: deja de pedir una renovación que ya no va a llegar. No
   * se borra: es el registro de hasta cuándo la unidad estuvo en regla. Mismo
   * mecanismo que `terminado_en` de los seguros.
   */
  terminado_en:     string | null
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

// Dar por terminado un permiso vencido —o revivirlo si fue un error—. El
// permiso no se borra: se archiva, y deja de aparecer en "Documentos por
// vencer". Espejo de useTerminarSeguro.
export function useTerminarPermisoCirculacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, terminado }: { id: number; terminado: boolean }) =>
      api.post<{ data: PermisoCirculacion }>(`/permisos-circulacion/${id}/terminar`, { terminado }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['permisos-circulacion'] })
      // Es justo el aviso del tablero lo que cambia.
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
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
      api.accion<void>(`/permisos-circulacion/${id}/vehiculos/${vehiculoId}/quitar`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehiculos'] }),
  })
}
