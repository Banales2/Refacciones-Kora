import { z } from 'zod'
import { TEXTO_LIBRE } from './common'

export const RefaccionCreateSchema = z.object({
  numero_serie: z
    .string()
    .min(1, 'Número de serie requerido')
    .max(20, 'Máximo 20 caracteres')
    .regex(/^[A-Z0-9-]+$/, 'Solo mayúsculas, números y guiones'),
  descripcion: z
    .string()
    .trim()
    .min(3, 'Mínimo 3 caracteres')
    .max(255, 'Máximo 255 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos'),
  // Obligatorio: el tipo es la única clasificación de la pieza. No es nullable,
  // así que el update tampoco puede dejar sin tipo una pieza que ya lo tiene.
  tipo_pieza_id: z.coerce
    .number({ error: 'Tipo de pieza requerido' })
    .int({ error: 'Tipo de pieza inválido' })
    .positive({ error: 'Tipo de pieza requerido' }),
})

export const RefaccionUpdateSchema = RefaccionCreateSchema.partial()

export const RefaccionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  searchBy: z.enum(['all', 'numero_serie', 'descripcion']).optional().default('all'),
})

export type RefaccionCreate = z.infer<typeof RefaccionCreateSchema>
export type RefaccionUpdate = z.infer<typeof RefaccionUpdateSchema>
export type RefaccionQuery = z.infer<typeof RefaccionQuerySchema>
export type SearchBy = 'all' | 'numero_serie' | 'descripcion'
