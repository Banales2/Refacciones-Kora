// Lotes de compra de una pieza: cada lote registra proveedor, factura, costo
// unitario y cantidades (inicial y disponible). El stock de una pieza es la
// suma de sus lotes; los mantenimientos descuentan de lotes específicos.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Lote {
  id: number
  pieza_id: number
  proveedor_id: number
  fecha_compra: string
  /**
   * Cuándo llega la mercancía al almacén. `null` = ya está ahí, que es el caso
   * de casi todo. Con una fecha que aún no pasa, el lote existe —el gasto ya
   * ocurrió— pero no cuenta como existencia y no se puede usar.
   */
  fecha_llegada: string | null
  costo_unitario: number
  cantidad_inicial: number
  cantidad_disponible: number
  num_factura: string | null
  /**
   * Tasa de IVA a SUMARLE a costo_unitario, en por ciento. null = el precio
   * capturado ya lo incluye (o la compra es exenta), que es el caso de todo lo
   * anterior a la migración 020. El importe no se guarda: sale de lib/totales.
   */
  tasa_iva: number | null
  /** `null` en el lote de recuperación: la pieza no salió de una compra. */
  proveedor: string | null
  // Sucursal de recepción. `cantidad_disponible` es la suma de lo que queda del
  // lote en todas las sucursales, no solo en esta.
  sucursal_id: number | null
  sucursal: string | null
  // Quién hizo la compra y quién la autorizó. El segundo lo pone la API con la
  // cuenta que registró el lote: no se manda ni se edita.
  comprado_por: string
  autorizado_por: string
}

interface LotesResponse {
  pieza: { id: number; numero_serie: string; descripcion: string }
  lotes: Lote[]
}

export interface LotePayload {
  proveedor_id: number
  // Solo al crear: la sucursal que recibe el lote. Al editar no se manda —
  // mover piezas a otra sucursal es un traspaso, no un cambio del lote.
  sucursal_id?: number
  fecha_compra: string
  // Cuándo llega la mercancía. `null` = ya está en el almacén. Mientras no
  // llegue, el lote no cuenta como existencia y la API niega consumirlo,
  // montarlo o traspasarlo. Va explícito en null para que el update sepa
  // distinguir "ya llegó" de "no toques este campo".
  fecha_llegada: string | null
  costo_unitario: number
  cantidad_inicial: number
  num_factura: string
  // null vuelve el lote a "el precio ya incluye IVA": se manda explícito para
  // que el update sepa distinguirlo de "no toques este campo".
  tasa_iva: number | null
  comprado_por: string
}

export function useLotes(piezaId: number | null) {
  return useQuery({
    queryKey: ['lotes', piezaId],
    queryFn: () => api.get<LotesResponse>(`/piezas/${piezaId}/lotes`),
    enabled: piezaId !== null,
  })
}

export function useCreateLote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ piezaId, ...body }: { piezaId: number } & LotePayload) =>
      api.post<{ data: Lote }>(`/piezas/${piezaId}/lotes`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['refacciones'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
      // El precio pagado es una de las dos fuentes de la comparativa: una
      // compra nueva cambia lo que ese proveedor cobra por esa refacción, y sin
      // esto la pantalla de precios seguía mostrando la anterior.
      qc.invalidateQueries({ queryKey: ['precios-proveedor'] })
    },
  })
}

export function useUpdateLote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<LotePayload>) =>
      api.put<{ data: Lote }>(`/lotes/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['refacciones'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
      // El precio pagado es una de las dos fuentes de la comparativa: una
      // compra nueva cambia lo que ese proveedor cobra por esa refacción, y sin
      // esto la pantalla de precios seguía mostrando la anterior.
      qc.invalidateQueries({ queryKey: ['precios-proveedor'] })
    },
  })
}

