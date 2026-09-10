import { z } from 'zod'
import { descuentoPct, numFactura, tasaIva } from './loteSchema'

export const FacturaQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Busca en el folio y en el nombre del proveedor. */
  search: z.string().max(100).optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

// La factura no tiene id: se identifica por su folio y el proveedor que la
// emitió. Va en el cuerpo y no en la ruta porque el folio admite diagonales
// ("A-123/2026") y en un path se partiría en dos segmentos.
//
// Los dos números que son de la factura y no del renglón —el IVA y el descuento
// del proveedor— se fijan juntos: forman un solo total y la pantalla los guarda
// de una vez. Ausente = null en ambos, así que quien llame tiene que mandar
// también el que no está cambiando.
export const FacturaTotalesSchema = z.object({
  num_factura: numFactura,
  proveedor_id: z.coerce.number().int().min(1, 'Proveedor requerido'),
  // null deja la factura en "el precio ya incluye IVA", que es como corregir de
  // vuelta una tasa puesta por error.
  tasa_iva: tasaIva,
  // null la deja sin descuento. Se resta al subtotal ANTES del IVA.
  descuento_pct: descuentoPct,
})

// Corregir el folio mal capturado de una compra. Se reescribe en todos sus
// lotes: la factura es el folio, así que cambiarlo en unos cuantos partiría la
// compra en dos. El proveedor no se toca — mover la compra a otro proveedor es
// otra cosa, y aquí solo se arregla un dato mal tecleado.
export const FacturaFolioSchema = z.object({
  num_factura: numFactura,
  proveedor_id: z.coerce.number().int().min(1, 'Proveedor requerido'),
  nuevo_num_factura: numFactura,
  /**
   * Sí, ya sé que el folio destino existe y aun así quiero usarlo: las dos
   * compras van a quedar como una sola factura. Sin esta bandera el intento se
   * rechaza — juntarlas es válido (un mismo papel capturado en dos tandas),
   * pero no puede pasar por accidente al corregir una letra.
   */
  confirmar_fusion: z.boolean().optional().default(false),
})

export type FacturaQuery = z.infer<typeof FacturaQuerySchema>
export type FacturaTotales = z.infer<typeof FacturaTotalesSchema>
export type FacturaFolio = z.infer<typeof FacturaFolioSchema>
