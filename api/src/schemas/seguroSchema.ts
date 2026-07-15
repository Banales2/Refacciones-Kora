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

export const SeguroAssignSchema = z.object({
  vehiculo_ids: z.array(z.coerce.number().int().positive()).min(1, 'Selecciona al menos un vehículo'),
})

export type SeguroCreate = z.infer<typeof SeguroCreateSchema>
export type SeguroUpdate = z.infer<typeof SeguroUpdateSchema>
export type SeguroAssign = z.infer<typeof SeguroAssignSchema>
