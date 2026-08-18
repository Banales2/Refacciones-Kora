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

// Posición que ocupa una pieza dentro de la unidad ("delantero", "trasero",
// "izquierdo"): lo que distingue dos renglones del mismo tipo. Cadena vacía —el
// caso normal, un tipo que va una sola vez— es válida y es el valor que se
// guarda; por eso no se usa NULL en la columna ni aquí.
export const EtiquetaPiezaSchema = z
  .string()
  .trim()
  .max(40, 'Máximo 40 caracteres')
  .refine(
    (v) => v === '' || /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 -]+$/.test(v),
    'Solo letras, números, espacios y guiones',
  )
  .default('')

export type TipoPiezaCreate = z.infer<typeof TipoPiezaCreateSchema>
export type TipoPiezaUpdate = z.infer<typeof TipoPiezaUpdateSchema>
