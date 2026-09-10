// Descuadres de inventario: lo que el sistema sabe que quedó mal contado y no
// puede arreglar solo.
//
// Hoy los produce un único caso —capturar un mantenimiento viejo cambiándole el
// destino a una pieza que ya estaba registrada como devuelta al almacén— y
// existen porque avisarlo en pantalla no alcanzaba: quien captura no es quien
// cuenta el estante, y el aviso se lo comía sin dejar rastro.
//
// Se cierran de dos formas, y las dos son finales legítimos: se ajustó la
// existencia, o se contó y no había nada que ajustar.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export type ResolucionDescuadre = 'ajustado' | 'aceptado'

export interface Descuadre {
  id:               number
  pieza_id:         number
  numero_serie:     string
  descripcion:      string
  sucursal_id:      number
  sucursal:         string
  lote_id:          number | null
  num_factura:      string | null
  /** Signo del almacén: +1 = el sistema cuenta una unidad que no está. */
  diferencia:       number
  origen:           string
  /** La explicación armada cuando se detectó. No se recalcula. */
  motivo:           string
  vehiculo_id:      number | null
  vehiculo:         string | null
  instalacion_id:   number | null
  mantenimiento_id: number | null
  status:           'abierto' | ResolucionDescuadre
  nota_resolucion:  string | null
  resuelto_por:     string | null
  resuelto_en:      string | null
  creado_por:       string | null
  created_at:       string
}

/**
 * Los descuadres abiertos. Sin sucursal, los de toda la flota: es lo que
 * necesita el aviso de arriba de la pantalla, para que uno en una sucursal que
 * nadie abre no se quede invisible.
 */
export function useDescuadres(sucursalId?: number) {
  return useQuery({
    queryKey: ['descuadres', sucursalId ?? 'todos'],
    queryFn: () => api.get<{ data: Descuadre[] }>(
      sucursalId !== undefined ? `/descuadres?sucursal_id=${sucursalId}` : '/descuadres',
    ),
  })
}

export function useResolverDescuadre() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, nota }: {
      id: number; status: ResolucionDescuadre; nota?: string | null
    }) => api.put<{ data: Descuadre }>(`/descuadres/${id}`, { status, nota: nota || null }),
    onSuccess: () => {
      // Todas las variantes de la lista, no solo la de esta sucursal: el aviso
      // global cuenta los de la flota entera y también acaba de cambiar.
      qc.invalidateQueries({ queryKey: ['descuadres'] })
      // Cerrarlo como "ajustado" implica que alguien ya corrigió la existencia.
      qc.invalidateQueries({ queryKey: ['inventario-existencias'] })
    },
  })
}
