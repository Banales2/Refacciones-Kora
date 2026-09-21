import { z } from 'zod'
import {
  compradoPor, descuentoPct, fechaCompra, numFactura, tasaIva,
} from './loteSchema'

// La mano de obra que cobra el papel del taller.
//
// Ver `db/migrations/046_facturas_de_mantenimiento.sql`.

export const RenglonManoObraSchema = z.object({
  /**
   * El mantenimiento que este renglón cobra, elegido de los candidatos.
   *
   * `null` se admite a propósito: que el papel cobre un trabajo que nadie
   * registró es el hallazgo que este cuadre existe para producir, y obligar a
   * casarlo con algo lo volvería invisible o haría que alguien lo casara con el
   * servicio equivocado con tal de poder guardar.
   */
  mantenimiento_id: z.coerce.number().int().positive().nullish(),
  /**
   * Lo que el papel cobra por ese trabajo. Cero es legítimo —una garantía puede
   * traer el renglón impreso sin cobro—; negativo no.
   */
  importe: z.coerce.number().min(0, 'El importe no puede ser negativo')
    .max(9999999.99, 'Importe demasiado grande'),
})

export const ManoObraSchema = z.object({
  /**
   * La mano de obra COMPLETA del papel, no lo que se agrega. La pantalla manda
   * la transcripción entera y el servidor reemplaza: mandar altas y bajas por
   * separado solo agrega una forma de que las dos versiones discrepen. Es el
   * mismo trato que `PUT /facturas/{id}/renglones`.
   */
  renglones: z.array(RenglonManoObraSchema)
    .max(100, 'Máximo 100 servicios por factura'),
})

/**
 * La factura del taller.
 *
 * Se pide el TALLER, no el proveedor. Que por debajo la factura cuelgue de un
 * proveedor es una consecuencia del modelo —la llave es (proveedor, folio) y el
 * mismo papel puede cobrar refacciones— y no algo que quien captura tenga que
 * saber. El puente lo resuelve `tecnicosRepo.proveedorDeTaller`.
 */
export const FacturaTallerSchema = z.object({
  tecnico_id: z.coerce.number().int().min(1, 'Taller requerido'),
  num_factura: numFactura,
  fecha_compra: fechaCompra,
  tasa_iva: tasaIva,
  descuento_pct: descuentoPct,
  /** Quién autorizó el trabajo, según el papel. */
  comprado_por: compradoPor,
})

export const SinFacturarQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tecnico_id: z.coerce.number().int().positive().optional(),
  /** Busca en la unidad, el taller y el tipo de servicio. */
  search: z.string().max(100).optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export type ManoObra = z.infer<typeof ManoObraSchema>
export type FacturaTaller = z.infer<typeof FacturaTallerSchema>
export type SinFacturarQuery = z.infer<typeof SinFacturarQuerySchema>
