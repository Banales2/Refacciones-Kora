import { z } from 'zod'

export const GasolineraCreateSchema = z.object({
  nombre:    z.string().trim().min(1, 'Nombre requerido').max(120),
  ubicacion: z.string().trim().min(1, 'Ubicación requerida').max(200),
})

export const GasolineraUpdateSchema = z.object({
  nombre:    z.string().trim().min(1).max(120).optional(),
  ubicacion: z.string().trim().min(1).max(200).optional(),
})

export type GasolineraCreate = z.infer<typeof GasolineraCreateSchema>
export type GasolineraUpdate = z.infer<typeof GasolineraUpdateSchema>
