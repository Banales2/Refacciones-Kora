import { z } from 'zod'

export const TipoPiezaCreateSchema = z.object({
  nombre: z.string().min(2, 'Nombre requerido').max(80, 'Máximo 80 caracteres'),
})

export const TipoPiezaUpdateSchema = TipoPiezaCreateSchema.partial()

export type TipoPiezaCreate = z.infer<typeof TipoPiezaCreateSchema>
export type TipoPiezaUpdate = z.infer<typeof TipoPiezaUpdateSchema>
