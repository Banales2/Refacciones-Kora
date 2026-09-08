import { z } from 'zod'

export const SeguroCreateSchema = z.object({
  poliza:           z.string().trim().min(1, 'Póliza requerida').max(60),
  compania:         z.string().trim().min(1, 'Compañía requerida').max(120),
  fecha_expiracion: z.string().date(),
})

export const SeguroUpdateSchema = z.object({
  poliza:           z.string().trim().min(1).max(60).optional(),
  compania:         z.string().trim().min(1).max(120).optional(),
  fecha_expiracion: z.string().date().optional(),
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
  }),
  z.object({
    modo:             z.literal('nueva_poliza'),
    poliza:           z.string().trim().min(1, 'Póliza requerida').max(60),
    // Ausente = sigue siendo la misma aseguradora, que es lo habitual.
    compania:         z.string().trim().min(1).max(120).optional(),
    fecha_expiracion: z.string().date(),
  }),
])

export const SeguroAssignSchema = z.object({
  vehiculo_ids: z.array(z.coerce.number().int().positive()).min(1, 'Selecciona al menos un vehículo'),
})

export type SeguroCreate = z.infer<typeof SeguroCreateSchema>
export type SeguroUpdate = z.infer<typeof SeguroUpdateSchema>
export type SeguroAssign  = z.infer<typeof SeguroAssignSchema>
export type SeguroRenovar = z.infer<typeof SeguroRenovarSchema>
