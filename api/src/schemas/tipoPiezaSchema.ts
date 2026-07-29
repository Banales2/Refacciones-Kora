import { z } from 'zod'

export const TipoPiezaCreateSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, 'Nombre requerido')
    .max(40, 'Máximo 40 caracteres')
    .regex(
      /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 -]+$/,
      'Solo letras, números, espacios y guiones',
    ),
})

export const TipoPiezaUpdateSchema = TipoPiezaCreateSchema.partial()

export type TipoPiezaCreate = z.infer<typeof TipoPiezaCreateSchema>
export type TipoPiezaUpdate = z.infer<typeof TipoPiezaUpdateSchema>
