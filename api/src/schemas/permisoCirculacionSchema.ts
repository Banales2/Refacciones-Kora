import { z } from 'zod'

export const PermisoCirculacionCreateSchema = z.object({
  zona_circulacion: z.string().trim().min(1, 'Zona requerida').max(120),
  fecha_emision:    z.string().date(),
  fecha_expiracion: z.string().date(),
})

export const PermisoCirculacionUpdateSchema = z.object({
  zona_circulacion: z.string().trim().min(1).max(120).optional(),
  fecha_emision:    z.string().date().optional(),
  fecha_expiracion: z.string().date().optional(),
})

export const PermisoCirculacionAssignSchema = z.object({
  vehiculo_ids: z.array(z.coerce.number().int().positive()).min(1, 'Selecciona al menos un vehículo'),
})

export type PermisoCirculacionCreate = z.infer<typeof PermisoCirculacionCreateSchema>
export type PermisoCirculacionUpdate = z.infer<typeof PermisoCirculacionUpdateSchema>
export type PermisoCirculacionAssign = z.infer<typeof PermisoCirculacionAssignSchema>
