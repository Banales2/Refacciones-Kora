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
 * El stock que está en el estante sin identidad, porque se compró antes de que
 * se encendiera el rastreo de su tipo.
 *
 * Se agrupa por (refacción, lote, sucursal): mismo estante, misma compra, mismo
 * costo. Es lo que hace falta para poder preguntar el folio de cada pieza.
 */
export interface GrupoSinIdentificar {
  pieza_id:     number
  numero_serie: string
  descripcion:  string
  lote_id:      number
  num_factura:  string | null
  proveedor:    string | null
  sucursal_id:  number | null
  sucursal:     string | null
  faltan:       number
}

export function useSinIdentificar(
  filtro: { tipoPiezaId?: number; piezaId?: number },
  enabled = true,
) {
  const qs = filtro.tipoPiezaId !== undefined
    ? `tipo_pieza_id=${filtro.tipoPiezaId}`
    : `pieza_id=${filtro.piezaId}`
  return useQuery({
    queryKey: ['unidades-sin-identificar', filtro.tipoPiezaId ?? null, filtro.piezaId ?? null],
    queryFn: () => api.get<{ data: GrupoSinIdentificar[] }>(`/unidades/sin-identificar?${qs}`),
    enabled: enabled && (filtro.tipoPiezaId !== undefined || filtro.piezaId !== undefined),
  })
}

export interface GrupoAIdentificar {
  pieza_id:     number
  lote_id:      number
  sucursal_id:  number | null
  /** Un folio por pieza. Los vacíos crean la unidad sin etiqueta. */
  etiquetas:    string[]
}

/**
 * Le da identidad —y nombre— al stock que ya estaba en el estante.
 *
 * Se manda con los folios ya capturados, no antes: una unidad en blanco no sirve
 * más que para volver a buscarla después. Los que se dejen vacíos sí crean la
 * unidad, porque la pieza existe aunque no traiga número grabado.
 */
export function useIdentificarExistentes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (grupos: GrupoAIdentificar[]) =>
      api.post<{ data: { creadas: number } }>('/unidades/identificar', { grupos }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['unidades-pieza'] })
      qc.invalidateQueries({ queryKey: ['unidades-sin-identificar'] })
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
