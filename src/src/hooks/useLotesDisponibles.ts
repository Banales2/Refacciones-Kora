// Existencias disponibles para consumir en un mantenimiento. Desde el
// inventario por sucursal hay una opción por (lote, sucursal), no una por lote:
// el mismo lote puede estar repartido y hay que elegir de dónde sale la pieza.
// `id` sigue siendo el id del lote, así que ya no identifica el renglón por sí
// solo — la llave es la pareja (id, sucursal_id).
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface LoteDisponible {
  id:                  number
  pieza_id:            number
  numero_serie:        string
  descripcion:         string
  costo_unitario:      number
  /** Lo que queda de ese lote en esa sucursal, no en toda la flota. */
  cantidad_disponible: number
  fecha_compra:        string
  sucursal_id:         number
  sucursal:            string
}

export function useLotesDisponibles(enabled: boolean) {
  return useQuery({
    queryKey: ['lotes-disponibles'],
    queryFn: () => api.get<{ data: LoteDisponible[] }>('/lotes-disponibles'),
    enabled,
  })
}
