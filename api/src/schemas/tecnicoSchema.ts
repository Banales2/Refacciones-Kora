import { z } from 'zod'
import { TEXTO_SIMPLE, TEXTO_LIBRE, CONTACTO } from './common'

const nombre = z
  .string()
  .trim()
  .min(2, 'Nombre requerido')
  .max(40, 'Máximo 40 caracteres')
  .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones')

const ubicacion = z
  .string()
  .trim()
  .min(1, 'Ubicación requerida')
  .max(100, 'Máximo 100 caracteres')
  .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')

// Teléfono o correo. Opcional: se guarda como NULL cuando no se captura.
const contacto = z
  .string()
  .trim()
  .max(40, 'Máximo 40 caracteres')
  .refine((v) => v === '' || CONTACTO.test(v), 'Contiene caracteres no permitidos')
  .nullable()
  .optional()

export const TecnicoCreateSchema = z.object({ nombre, ubicacion, contacto })

export const TecnicoUpdateSchema = z.object({
  nombre:    nombre.optional(),
  ubicacion: ubicacion.optional(),
  contacto,
})

export type TecnicoCreate = z.infer<typeof TecnicoCreateSchema>
export type TecnicoUpdate = z.infer<typeof TecnicoUpdateSchema>
