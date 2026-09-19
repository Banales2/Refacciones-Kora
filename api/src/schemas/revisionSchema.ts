import { z } from 'zod'
import { descuentoPct, fechaCompra, numFactura, tasaIva } from './loteSchema'

// La revisión de una factura contra su papel.
//
// LOS VALORES NO SON OPCIONALES, y esa es la decisión que da forma a todo lo
// demás. El verificador no manda "lo que quiere cambiar": manda LO QUE DICE EL
// PAPEL, siempre completo, y el sistema lo compara contra lo guardado. Si
// coincide, no hay corrección que registrar; si no, ahí está el error y su
// importe.
//
// Dejarlos opcionales convertiría esto en otra pantalla de edición, y entonces
// un renglón mal capturado que el verificador no miró quedaría sellado como
// bueno sin que nadie lo haya leído nunca. La diferencia entre revisar y editar
// es exactamente esta.
//
// Ver `db/migrations/040_revision_de_facturas.sql`.

export const CabeceraRevisarSchema = z.object({
  /** El folio tal como viene impreso. Si no coincide, se corrige al sellar. */
  num_factura: numFactura,
  fecha_compra: fechaCompra,
  // null = el precio ya incluye IVA (o la compra es exenta). No es cero.
  tasa_iva: tasaIva,
  // null = la factura no trae descuento. Tampoco es cero.
  descuento_pct: descuentoPct,
  /**
   * Lo que el verificador quiera dejar dicho del documento: "el papel viene
   * roto", "el proveedor la reexpidió". Es de la factura, no de un renglón.
   */
  nota: z.string().trim().max(255, 'Máximo 255 caracteres').optional(),
  /**
   * Corregir el folio hacia uno que ese proveedor ya tiene fusiona las dos
   * facturas. Es legítimo —el mismo papel capturado en dos tandas— pero no
   * puede pasar por accidente, así que la API responde 409 FOLIO_EXISTENTE y
   * espera este consentimiento explícito. Ver `facturasService.setFolio`.
   */
  confirmar_fusion: z.boolean().optional().default(false),
})

// El proveedor no está aquí a propósito: cambiarlo mueve la factura a otro
// proveedor entero, y la llave (proveedor, folio) haría que dejara de ser la
// misma compra. Corregir un proveedor mal elegido es una operación aparte, no
// un renglón más de la revisión.

export const ErroresQuerySchema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/** El detalle detrás del acumulado, opcionalmente el de una sola persona. */
export const CorreccionesQuerySchema = ErroresQuerySchema.extend({
  capturado_por: z.string().trim().max(120).optional(),
})

export type CabeceraRevisar = z.infer<typeof CabeceraRevisarSchema>
export type ErroresQuery = z.infer<typeof ErroresQuerySchema>
export type CorreccionesQuery = z.infer<typeof CorreccionesQuerySchema>
