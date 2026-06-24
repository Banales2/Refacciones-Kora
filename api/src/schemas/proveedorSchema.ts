import { z } from 'zod'

export const ProveedorCreateSchema = z.object({
  nombre:   z.string().min(2, 'Mínimo 2 caracteres').max(100, 'Máximo 100 caracteres').trim(),
  contacto: z.string().max(100).trim().nullable().optional(),
})

export const ProveedorUpdateSchema = ProveedorCreateSchema.partial()

export type ProveedorCreate = z.infer<typeof ProveedorCreateSchema>
export type ProveedorUpdate = z.infer<typeof ProveedorUpdateSchema>
