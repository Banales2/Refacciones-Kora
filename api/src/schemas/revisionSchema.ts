import { z } from 'zod'

// Los reportes de la revisión: cuánto lleva equivocado cada quien y el detalle
// detrás. Lo que el verificador manda al cuadrar vive en `cuadreSchema`.
//
// Ver `db/migrations/040_revision_de_facturas.sql`.

export const ErroresQuerySchema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/** El detalle detrás del acumulado, opcionalmente el de una sola persona. */
export const CorreccionesQuerySchema = ErroresQuerySchema.extend({
  capturado_por: z.string().trim().max(120).optional(),
})

export type ErroresQuery = z.infer<typeof ErroresQuerySchema>
export type CorreccionesQuery = z.infer<typeof CorreccionesQuerySchema>
