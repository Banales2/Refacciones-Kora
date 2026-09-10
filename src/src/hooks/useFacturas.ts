// Las facturas de compra de refacciones.
//
// No son una tabla: son los lotes que comparten folio y proveedor (ver
// `useCompras`). Esta vista los vuelve a juntar, que es lo que hace falta para
// cuadrar contra el papel y, sobre todo, para meterle el IVA a una compra vieja
// —capturada cuando la casilla no existía y que por eso quedó como "el precio
// ya lo incluye"—.
//
// La llave es (folio, proveedor), no el folio solo: dos proveedores pueden
// emitir un "A-100" cada uno y no son la misma compra.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface FacturaRenglon {
  lote_id:             number
  pieza_id:            number
  numero_serie:        string
  descripcion:         string
  cantidad_inicial:    number
  cantidad_disponible: number
  costo_unitario:      number
  sucursal:            string | null
}

export interface Factura {
  num_factura:  string
  proveedor_id: number
  proveedor:    string
  fecha_compra: string
  renglones:    number
  /** Suma de costo × cantidad de todos sus renglones, sin IVA. */
  subtotal:     number
  /** null = los precios ya incluyen IVA (o la compra es exenta). */
  tasa_iva:     number | null
  /**
   * Descuento del proveedor sobre el total, en por ciento. null = no trae. Se
   * resta al subtotal ANTES del IVA, que es como lo emite el proveedor: ver
   * `totalesFactura` en `lib/totales`.
   */
  descuento_pct: number | null
  /**
   * Sus lotes no coinciden en la tasa o en el descuento. Pasa si alguien
   * corrigió un lote suelto desde el drawer de la refacción; se emparejan
   * volviendo a fijarlos aquí.
   */
  totales_dispares: boolean
  detalle:      FacturaRenglon[]
}

export interface FacturasFiltros {
  page?:     number
  pageSize?: number
  search?:   string
  desde?:    string
  hasta?:    string
}

interface FacturasResponse {
  data: Factura[]
  pagination: { page: number; pageSize: number; total: number }
}

export function useFacturas(filtros: FacturasFiltros, enabled = true) {
  return useQuery({
    queryKey: ['facturas', filtros],
    queryFn: () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filtros)) {
        if (v !== undefined && v !== '') qs.set(k, String(v))
      }
      return api.get<FacturasResponse>(`/facturas?${qs}`)
    },
    enabled,
  })
}

export interface FacturaTotalesPayload {
  num_factura:  string
  proveedor_id: number
  /** null devuelve la factura a "el precio ya incluye IVA". */
  tasa_iva:     number | null
  /** null la devuelve a "sin descuento". */
  descuento_pct: number | null
}

/**
 * Fija la tasa y el descuento en todos los lotes de la factura de un golpe.
 *
 * Los dos viajan siempre juntos, aunque solo cambie uno: la API escribe ambos
 * y el que no cambia se manda con el valor que ya tenía. Juntos son el total de
 * la factura, y guardarlos por separado deja el desglose a medias.
 */
export function useSetTotalesFactura() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: FacturaTotalesPayload) =>
      api.put<{ data: { lotes_actualizados: number } }>('/facturas/totales', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facturas'] })
      // Los lotes cambiaron: el drawer de la refacción y cualquier lista que
      // los muestre traen la tasa y el descuento viejos.
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
    },
  })
}

export interface FacturaFolioPayload {
  num_factura:       string
  proveedor_id:      number
  nuevo_num_factura: string
  /**
   * Usar un folio que ese proveedor ya tiene, a sabiendas: las dos compras
   * quedan como una sola factura. Sin esto la API responde 409 con el código
   * FOLIO_EXISTENTE, que es la señal para preguntarle al usuario.
   */
  confirmar_fusion?: boolean
}

/** El 409 que pide confirmar antes de juntar dos compras en una factura. */
export const FOLIO_EXISTENTE = 'FOLIO_EXISTENTE'

/**
 * Corrige el folio mal capturado de la compra, reescribiéndolo en todos sus
 * lotes.
 */
export function useSetFolioFactura() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: FacturaFolioPayload) =>
      api.put<{ data: { num_factura: string; lotes_actualizados: number } }>(
        '/facturas/folio', payload,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facturas'] })
      // El folio se ve en el drawer de la refacción, en el inventario y en las
      // compras del proveedor: todas esas listas traen el viejo.
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
      qc.invalidateQueries({ queryKey: ['inventario-existencias'] })
      qc.invalidateQueries({ queryKey: ['proveedor-gastos'] })
    },
  })
}

/**
 * Cambia el folio de UN renglón. Es lo que permite sacar de la factura un lote
 * que no pertenecía a ella —o que se juntó al fusionar dos compras— sin tocar
 * los demás. Reusa el update del lote: el folio es un campo suyo.
 */
export function useSetFolioLote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lote_id, num_factura }: { lote_id: number; num_factura: string }) =>
      api.put<{ data: { id: number } }>(`/lotes/${lote_id}`, { num_factura }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facturas'] })
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
      qc.invalidateQueries({ queryKey: ['inventario-existencias'] })
      qc.invalidateQueries({ queryKey: ['proveedor-gastos'] })
    },
  })
}
