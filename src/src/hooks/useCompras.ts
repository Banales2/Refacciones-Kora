// Compra de varias refacciones bajo una misma factura.
//
// No hay tabla `compras`: lo que se guarda son N lotes que comparten proveedor,
// sucursal, fecha y `num_factura`. La factura es lo que los vuelve a juntar
// cuando hay que cuadrar el gasto contra el papel.
//
// Va en una sola llamada, no en un POST por renglón: la API los mete en una
// transacción, así que o entra la factura entera o no entra nada. Media factura
// registrada es stock real que nadie sabe que está incompleto.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { LoteDisponible } from './useLotesDisponibles'

/** Refacción nueva que se da de alta junto con su primera compra. */
export interface PiezaNuevaPayload {
  numero_serie:  string
  descripcion:   string
  tipo_pieza_id: number
}

/**
 * Un renglón de la factura: o apunta a una refacción del catálogo (`pieza_id`)
 * o trae una nueva (`pieza_nueva`), nunca las dos.
 */
export interface CompraRenglonPayload {
  pieza_id?:         number
  pieza_nueva?:      PiezaNuevaPayload
  cantidad_inicial:  number
  costo_unitario:    number
}

export interface CompraPayload {
  proveedor_id:  number
  sucursal_id:   number
  fecha_compra:  string
  num_factura:   string
  // El IVA es de la factura, no del renglón: una sola tasa para todos. null =
  // los precios capturados ya lo incluyen.
  tasa_iva:      number | null
  // El descuento del proveedor sobre el total, también de la factura. Se resta
  // al subtotal ANTES del IVA. null = la factura no trae descuento.
  descuento_pct: number | null
  comprado_por:  string
  renglones:     CompraRenglonPayload[]
}

/** Cada lote creado llega ya con forma de existencia consumible. */
export interface CompraLote extends LoteDisponible {
  //  lo hereda de LoteDisponible: la compra lo devuelve para que
  // una refacción recién dada de alta se pueda montar sin recargar la lista.
  /** La tasa de la factura, la misma en todos sus renglones. */
  tasa_iva:    number | null
  /** El descuento de la factura, el mismo en todos sus renglones. */
  descuento_pct: number | null
  /** Verdadero si la refacción se dio de alta en esta misma compra. */
  pieza_nueva: boolean
}

export interface CompraCreada {
  num_factura: string
  lotes:       CompraLote[]
}

export function useCreateCompra() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CompraPayload) => api.post<{ data: CompraCreada }>('/compras', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lotes'] })
      qc.invalidateQueries({ queryKey: ['refacciones'] })
      qc.invalidateQueries({ queryKey: ['lotes-disponibles'] })
      // La compra puede haber dado de alta refacciones y, con ellas, tipos de
      // pieza nuevos desde el propio renglón.
      qc.invalidateQueries({ queryKey: ['tipos-pieza'] })
      // La compra entra completa en una sucursal: su inventario cambió.
      qc.invalidateQueries({ queryKey: ['inventario-existencias'] })
    },
  })
}
