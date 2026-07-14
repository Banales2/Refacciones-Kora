import { z } from 'zod'

export const ConductorCreateSchema = z.object({
  nombre: z.string().trim().min(1, 'Nombre requerido').max(120),
})

export const ConductorUpdateSchema = z.object({
  nombre: z.string().trim().min(1).max(120).optional(),
})

export type ConductorCreate = z.infer<typeof ConductorCreateSchema>
export type ConductorUpdate = z.infer<typeof ConductorUpdateSchema>
