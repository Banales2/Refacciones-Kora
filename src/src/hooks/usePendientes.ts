// Lo que un vehículo tiene abierto, de los dos tipos a la vez: preventivos e
// incidencias. Alimenta los selectores de "qué atiende este mantenimiento" y de
// las agendas, que no distinguen entre uno y otro más allá de agruparlos.
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export type OrigenPendiente = 'preventivo' | 'incidencia'

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
  preventivo: 'Requerimientos preventivos',
  incidencia: 'Incidencias',
}

export function usePendientes(vehiculoId: number) {
  return useQuery({
    queryKey: ['pendientes', vehiculoId],
    queryFn: () => api.get<{ data: Pendiente[] }>(`/vehiculos/${vehiculoId}/pendientes`),
    enabled: vehiculoId > 0,
  })
}
