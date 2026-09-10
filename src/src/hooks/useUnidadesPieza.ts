// Las piezas físicas de una refacción, una por una.
//
// Solo existen para los tipos con rastreo individual (se enciende en Refacciones
// → Tipos de pieza). Para lo que se cuenta a granel la lista viene vacía, y eso
// no es un error: es que esa refacción no se rastrea pieza por pieza.
//
// Casi todo lo que se ve aquí es derivado de la bitácora de instalaciones —dónde
// está, si es nueva o usada, cuántos kilómetros lleva—, así que no se edita: se
// corrige montando y desmontando. Lo único que se captura a mano es la etiqueta.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export type EstadoUnidad =
  | 'almacen' | 'montada' | 'desechada' | 'vendida' | 'devuelta' | 'reacondicionar'

export interface UnidadPieza {
  id:             number
  pieza_id:       number
  numero_serie:   string
  descripcion:    string
  lote_id:        number | null
  /** El folio de la compra de la que salió. `null` si no salió de ninguna. */
  num_factura:    string | null
  proveedor:      string | null
  costo_unitario: number | null
  sucursal_id:    number | null
  sucursal:       string | null
  /** El folio físico pegado a la pieza, si trae uno. Lo único editable. */
  etiqueta:       string | null
  estado:         EstadoUnidad
  condicion:      'nueva' | 'usada'
  vehiculo_id:    number | null
  vehiculo:       string | null
  /** Desde cuándo lleva puesta la instalación vigente. */
  desde:          string | null
  montajes:       number
  /** `null` si nunca se ha montado o si no se capturaron los kilometrajes. */
  km_recorridos:  number | null
}

export const ESTADO_UNIDAD: Record<EstadoUnidad, { label: string; color: string }> = {
  almacen:        { label: 'En almacén',      color: 'green'  },
  montada:        { label: 'Montada',         color: 'blue'   },
  desechada:      { label: 'Desechada',       color: 'gray'   },
  vendida:        { label: 'Vendida',         color: 'grape'  },
  devuelta:       { label: 'Devuelta',        color: 'orange' },
  reacondicionar: { label: 'A reacondicionar', color: 'yellow' },
}

export function useUnidadesPieza(piezaId: number | null) {
  return useQuery({
    queryKey: ['unidades-pieza', piezaId],
    queryFn: () => api.get<{ data: UnidadPieza[] }>(`/piezas/${piezaId}/unidades`),
    enabled: piezaId !== null,
  })
}

/**
 * Le da identidad al stock que ya estaba en el estante cuando se encendió el
 * rastreo de este tipo.
 *
 * Encender el interruptor no hace aparecer unidades para lo ya comprado: esas
 * piezas están en la existencia pero no se pueden identificar. Esto crea las que
 * faltan, sin etiqueta, para poder rotularlas una por una.
 */
export function useGenerarUnidades(piezaId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ data: { creadas: number } }>(
      `/piezas/${piezaId}/unidades/generar`, {},
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['unidades-pieza', piezaId] })
      qc.invalidateQueries({ queryKey: ['unidades-cuadre'] })
    },
  })
}

export function useSetEtiquetaUnidad(piezaId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, etiqueta }: { id: number; etiqueta: string | null }) =>
      api.put<{ data: { id: number } }>(`/unidades/${id}/etiqueta`, { etiqueta }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['unidades-pieza', piezaId] }),
  })
}
