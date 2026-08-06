import { z } from 'zod'
import { TELEFONO } from './common'

export const ProveedorCreateSchema = z.object({
  nombre:   z.string().min(2, 'Mínimo 2 caracteres').max(100, 'Máximo 100 caracteres').trim(),
  contacto: z.string().max(100).trim().nullable().optional(),
  // Vacío se guarda como NULL, no como cadena vacía.
  telefono: z
    .string()
    .trim()
    .max(12, 'Máximo 12 caracteres')
    .refine((v) => v === '' || TELEFONO.test(v), 'Solo números, espacios, paréntesis, + y guiones')
    .nullable()
    .optional(),
})

export const ProveedorUpdateSchema = ProveedorCreateSchema.partial()

export type ProveedorCreate = z.infer<typeof ProveedorCreateSchema>
export type ProveedorUpdate = z.infer<typeof ProveedorUpdateSchema>
