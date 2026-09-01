// Requerimientos de mantenimiento propios de un vehículo: tareas recurrentes
// que vencen por kilometraje, por tiempo o por ambos. Pueden nacer de la
// plantilla del modelo (plantilla_origen_id) o crearse a mano.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export type TriggerMode = 'km' | 'meses' | 'ambos'
// 'completado' ya no se puede asignar a un preventivo —no se termina, se le
// reinicia el ciclo— pero se conserva en el tipo para que un registro viejo que
// lo traiga se siga mostrando en vez de romper la tabla.
export type StatusReq   = 'activo' | 'completado' | 'pausado' | 'cancelado'

export interface RequerimientoExclusivo {
  id:                  number
  // Siempre 'preventivo': el otro hijo de `pendientes` son las incidencias.
  origen:              'preventivo'
  nombre:              string
  descripcion:         string | null
  categoria:           string | null
  intervalo_km:        number | null
  intervalo_meses:     number | null
  /**
   * Los primeros servicios que no siguen el intervalo de ciclo, en orden y como
   * distancias entre servicios: [5000, 10000] con intervalo_km 15000 = primero
   * a los 5,000 km, segundo 10,000 km después de ese, y de ahí cada 15,000.
   * null = todos los servicios al mismo intervalo.
   */
  intervalos_iniciales_km: number[] | null
  trigger_mode:        TriggerMode
  status:              StatusReq
  created_at:          string
  updated_at:          string
  vehiculo_id:         number
  plantilla_origen_id: number | null
  fecha_inicio:        string | null
  km_inicio:           number | null
  fecha_reporte:       string | null
  /** Garantías de la unidad que obligan a este servicio. Vacío = se pide siempre. */
  garantia_ids:        number[]
  /**
   * Todas sus garantías se vencieron o se cancelaron: el servicio existía para
   * no perderlas y ya no hay nada que perder. Lo calcula la API contra la fecha
   * de arranque y el odómetro; aquí solo se pinta.
   */
  silenciado_por_garantia: boolean
}

export interface RequerimientoPayload {
  nombre:           string
  descripcion?:     string | null
  categoria?:       string | null
  trigger_mode:     TriggerMode
  intervalo_km?:    number | null
  intervalo_meses?: number | null
  /** Ausente en una edición = no se toca; null o [] = sin primeros servicios. */
  intervalos_iniciales_km?: number[] | null
  status?:          StatusReq
  fecha_inicio?:    string | null
  km_inicio?:       number | null
  fecha_reporte?:   string | null
  /** Ausente en una edición = no se tocan las garantías atadas; [] = se desatan. */
  garantia_ids?:    number[]
}

export function useRequerimientos(vehiculoId: number) {
  return useQuery({
    queryKey: ['requerimientos', vehiculoId],
    queryFn: () => api.get<{ data: RequerimientoExclusivo[] }>(`/vehiculos/${vehiculoId}/requerimientos`),
  })
}

// Categorías ya usadas en toda la flota, para el selector del formulario.
export function useRequerimientoCategorias() {
  return useQuery({
    queryKey: ['requerimientos-categorias'],
    queryFn: () => api.get<{ data: string[] }>('/requerimientos/categorias'),
  })
}

export function useCreateRequerimiento(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: RequerimientoPayload) =>
      api.post<{ data: RequerimientoExclusivo }>(`/vehiculos/${vehiculoId}/requerimientos`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requerimientos', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['pendientes', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['requerimientos-categorias'] })
    },
  })
}

export function useUpdateRequerimiento(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<RequerimientoPayload> }) =>
      api.put<{ data: RequerimientoExclusivo }>(`/requerimientos/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requerimientos', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['pendientes', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['requerimientos-categorias'] })
    },
  })
}

export function useDeleteRequerimiento(vehiculoId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/requerimientos/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requerimientos', vehiculoId] })
      qc.invalidateQueries({ queryKey: ['pendientes', vehiculoId] })
    },
  })
}
