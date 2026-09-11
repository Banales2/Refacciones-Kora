import { z } from 'zod'

// Lo que se pagó por la póliza. Opcional: muchas ya capturadas no traen el dato
// y no hay de dónde sacarlo. Nulo es "no se capturó", que no es cero.
const costo = z.coerce.number()
  .min(0, 'No puede ser negativo')
  .max(99_999_999, 'Máximo $99,999,999')
  .nullable().optional()

export const SeguroCreateSchema = z.object({
  poliza:           z.string().trim().min(1, 'Póliza requerida').max(60),
  compania:         z.string().trim().min(1, 'Compañía requerida').max(120),
  fecha_expiracion: z.string().date(),
  costo,
})

export const SeguroUpdateSchema = z.object({
  poliza:           z.string().trim().min(1).max(60).optional(),
  compania:         z.string().trim().min(1).max(120).optional(),
  fecha_expiracion: z.string().date().optional(),
  costo,
})

/**
 * Renovar una póliza, de las dos maneras en que se renueva de verdad:
 *
 * - `extender`: la aseguradora prolonga la misma póliza. No hay documento
 *   nuevo, solo una fecha nueva.
 * - `nueva_poliza`: sale otra póliza —con otro número, y a veces con otra
 *   compañía— que cubre las mismas unidades. La vieja se queda como registro
 *   de lo que estuvo vigente hasta esa fecha.
 *
 * Es un union discriminado porque los campos no son los mismos: exigir la
 * póliza nueva en el modo que no la usa obligaría a mandar un valor de relleno.
 */
export const SeguroRenovarSchema = z.discriminatedUnion('modo', [
  z.object({
    modo:             z.literal('extender'),
    fecha_expiracion: z.string().date(),
    // Lo que costó la renovación. Al extender pisa al costo anterior: es una
    // sola póliza y una sola fila (ver la migración 018).
    costo,
  }),
  z.object({
    modo:             z.literal('nueva_poliza'),
    poliza:           z.string().trim().min(1, 'Póliza requerida').max(60),
    // Ausente = sigue siendo la misma aseguradora, que es lo habitual.
    compania:         z.string().trim().min(1).max(120).optional(),
    fecha_expiracion: z.string().date(),
    // Va con la póliza nueva; el de la anterior se queda donde estaba, así que
    // el historial de precios sale solo.
    costo,
  }),
])

/**
 * Dar por terminada una póliza, o reactivarla. Lo único que viaja es el
 * interruptor: la fecha la pone el servidor (ver `segurosRepo.setTerminado`).
 * `terminado` explícito y no dos rutas distintas porque deshacer es tan normal
 * como hacer —se archiva la póliza equivocada y se nota enseguida—.
 */
export const SeguroTerminarSchema = z.object({
  terminado: z.boolean().default(true),
})

export const SeguroAssignSchema = z.object({
  vehiculo_ids: z.array(z.coerce.number().int().positive()).min(1, 'Selecciona al menos un vehículo'),
})

export type SeguroCreate = z.infer<typeof SeguroCreateSchema>
export type SeguroUpdate = z.infer<typeof SeguroUpdateSchema>
export type SeguroAssign  = z.infer<typeof SeguroAssignSchema>
export type SeguroTerminar = z.infer<typeof SeguroTerminarSchema>
export type SeguroRenovar = z.infer<typeof SeguroRenovarSchema>
