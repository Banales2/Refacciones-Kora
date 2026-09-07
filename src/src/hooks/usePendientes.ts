// Lo que un vehículo tiene abierto. Alimenta los selectores de "qué atiende
// este mantenimiento" y de las agendas.
//
// Desde que los requerimientos preventivos se fueron con el programa de
// mantenimiento, el único origen es la incidencia; se conserva el campo porque
// así llega del API y porque los selectores siguen agrupando por él.
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export type OrigenPendiente = 'incidencia'

export interface Pendiente {
  id:          number
  vehiculo_id: number
  origen:      OrigenPendiente
  nombre:      string
  descripcion: string | null
  categoria:   string | null
  status:      'activo' | 'completado' | 'pausado' | 'cancelado'
  created_at:  string
  updated_at:  string
}

export const ORIGEN_LABEL: Record<OrigenPendiente, string> = {
  incidencia: 'Incidencias',
}

export function usePendientes(vehiculoId: number) {
  return useQuery({
    queryKey: ['pendientes', vehiculoId],
    queryFn: () => api.get<{ data: Pendiente[] }>(`/vehiculos/${vehiculoId}/pendientes`),
    enabled: vehiculoId > 0,
  })
}

// Categorías ya capturadas en la flota o en algún programa de mantenimiento,
// para el selector de los formularios que las piden. No hay catálogo: se
// reaprovecha lo escrito.
export function usePendienteCategorias() {
  return useQuery({
    queryKey: ['pendientes-categorias'],
    queryFn: () => api.get<{ data: string[] }>('/pendientes/categorias'),
  })
}
