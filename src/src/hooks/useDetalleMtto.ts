// Detalle de un mantenimiento: las piezas usadas, cada una descontada de un
// lote de compra específico (lote_id) con su cantidad y costo unitario.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Mantenimiento } from './useMantenimientos'

export interface DetalleMttoPieza {
  id:               number
  mantenimiento_id: number
  lote_id:          number
  cantidad:         number
  costo_unitario:   number
  pieza_id:         number
  /** Tipo de la refacción: dice en qué renglones del vehículo puede montarse. */
  tipo_pieza_id:    number | null
  numero_serie:     string
  descripcion:      string
  /** Lo que queda de ese lote en la sucursal de la que salió este consumo. */
  lote_disponible:  number
  // De qué sucursal salió. Null en los consumos anteriores al inventario por
  // sucursal que además pertenecen a un lote sin sucursal de recepción.
  sucursal_id:      number | null
  sucursal:         string | null
  /** Cuántas de estas piezas ya se montaron en la unidad. */
  montadas:         number
}

interface DetalleMttoResponse {
  mantenimiento: Mantenimiento
  detalles:      DetalleMttoPieza[]
}

/**
 * Dónde quedó puesta una de las piezas del consumo.
 *
 * Capturar el consumo y montar la pieza eran dos pasos separados. Todo lo que
 * el montaje necesita ya lo sabe el mantenimiento —lote, sucursal, fecha y km—
 * salvo esto: la posición. Va aquí para que sea una sola captura.
 */
export interface MontajeConsumo {
  /** Qué renglón de ese tipo ('' = el tipo va una sola vez en la unidad). */
  etiqueta:       string
  /** De la pieza que SALE, cuando el renglón ya traía una. */
  motivo_retiro?: string | null
  destino?:       string | null
}

export interface DetalleMttoPayload {
  lote_id:         number
  // De qué sucursal se descuenta. Obligatoria al crear; al editar no se manda,
  // porque el consumo se corrige donde se registró.
  sucursal_id?:    number
  cantidad:        number
  costo_unitario?: number
  /**
   * En qué posiciones de la unidad se montó. Vacío o ausente = no se monta, que
   * es lo correcto para lo que se gasta sin instalarse (aceite, limpiadores) y
   * para la captura que prefiere montar después.
   */
  montajes?:       MontajeConsumo[]
}

export function useDetalleMtto(mantenimientoId: number | null) {
  return useQuery({
    queryKey: ['detalle-mtto', mantenimientoId],
    queryFn: () => api.get<DetalleMttoResponse>(`/mantenimientos/${mantenimientoId}/detalle`),
    enabled: mantenimientoId !== null,
  })
}

/**
 * El consumo se guarda aunque el montaje falle, así que la API contesta 201 con
 * el aviso en vez de un error: dar el gasto por perdido sería peor. `null`
 * cuando todo quedó montado (o cuando no había nada que montar).
 */
interface DetalleCreado {
  data:           DetalleMttoPieza
  montaje_error?: string | null
}

// Montar una pieza cambia lo que la unidad trae puesto y su historial, además
// del consumo. Sin esto, la ficha del vehículo seguiría mostrando la refacción
// anterior.
function invalidarTrasConsumo(qc: ReturnType<typeof useQueryClient>, mantenimientoId: number | null) {
  qc.invalidateQueries({ queryKey: ['detalle-mtto', mantenimientoId] })
  qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
  qc.invalidateQueries({ queryKey: ['piezas-vehiculo'] })
  qc.invalidateQueries({ queryKey: ['piezas-historial'] })
  qc.invalidateQueries({ queryKey: ['consumos-sin-montar'] })
}

export function useCreateDetalleMtto(mantenimientoId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: DetalleMttoPayload) =>
      api.post<DetalleCreado>(`/mantenimientos/${mantenimientoId}/detalle`, payload),
    onSuccess: () => invalidarTrasConsumo(qc, mantenimientoId),
  })
}

// Registra de golpe las piezas capturadas al dar de alta un mantenimiento. Van
// en serie (no en paralelo) porque cada una descuenta stock de su lote y el
// backend valida la existencia disponible en cada alta.
export function useCreateDetallesMtto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ mantenimientoId, piezas }: { mantenimientoId: number; piezas: DetalleMttoPayload[] }) => {
      // Los avisos de montaje se juntan y se devuelven: cada uno es un consumo
      // que sí quedó guardado pero que no se pudo montar, y callarlos dejaría
      // la pieza sin poner sin que nadie se entere.
      const avisos: string[] = []
      for (const pieza of piezas) {
        const res = await api.post<DetalleCreado>(`/mantenimientos/${mantenimientoId}/detalle`, pieza)
        if (res.montaje_error) avisos.push(res.montaje_error)
      }
      return avisos
    },
    onSettled: (_data, _err, { mantenimientoId }) => {
      // Incluso si una pieza falla a medias, las anteriores sí se guardaron:
      // se refresca igual para que la pantalla refleje el estado real.
      invalidarTrasConsumo(qc, mantenimientoId)
      qc.invalidateQueries({ queryKey: ['mantenimientos'] })
    },
  })
}

export function useUpdateDetalleMtto(mantenimientoId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: number } & Partial<DetalleMttoPayload>) =>
      api.put<{ data: DetalleMttoPieza }>(`/detalle-mtto/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['detalle-mtto', mantenimientoId] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
    },
  })
}

export function useDeleteDetalleMtto(mantenimientoId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/detalle-mtto/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['detalle-mtto', mantenimientoId] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
    },
  })
}
