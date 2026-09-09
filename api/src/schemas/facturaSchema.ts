import { z } from 'zod'
import { numFactura, tasaIva } from './loteSchema'

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
export const FacturaIvaSchema = z.object({
  num_factura: numFactura,
  proveedor_id: z.coerce.number().int().min(1, 'Proveedor requerido'),
  // null deja la factura en "el precio ya incluye IVA", que es como corregir de
  // vuelta una tasa puesta por error.
  tasa_iva: tasaIva,
})

export type FacturaQuery = z.infer<typeof FacturaQuerySchema>
export type FacturaIva = z.infer<typeof FacturaIvaSchema>
