import { z } from 'zod'
import { TEXTO_SIMPLE, TEXTO_LIBRE } from './common'

// "HH:MM" o "HH:MM:SS". La hora es opcional: quien reporta no siempre la sabe.
const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

export const IncidenciaBase = {
  nombre: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(40, 'Máximo 40 caracteres')
    .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones'),
  descripcion: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(255, 'Máximo 255 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos'),
  categoria: z
    .string()
    .trim()
    .max(30, 'Máximo 30 caracteres')
    .refine((v) => v === '' || TEXTO_SIMPLE.test(v), 'Solo letras, números, espacios y guiones')
    .nullable()
    .optional(),
  reportado_por: z
    .string()
    .trim()
    .max(120, 'Máximo 120 caracteres')
    .refine((v) => v === '' || TEXTO_SIMPLE.test(v), 'Solo letras, números, espacios y guiones')
    .nullable()
    .optional(),
  ubicacion: z
    .string()
    .trim()
    .max(160, 'Máximo 160 caracteres')
    .refine((v) => v === '' || TEXTO_LIBRE.test(v), 'Contiene caracteres no permitidos')
    .nullable()
    .optional(),
  severidad: z.enum(['superficial', 'moderada', 'grave']),
  fecha:     z.string().date(),
  hora:      z.string().regex(HORA, 'Formato HH:MM').nullable().optional(),
}

export const IncidenciaCreateSchema = z.object({
  ...IncidenciaBase,
  status: z.enum(['activo', 'completado', 'pausado', 'cancelado']).default('activo'),
})

export const IncidenciaUpdateSchema = z.object({
  ...IncidenciaBase,
  nombre:      IncidenciaBase.nombre.optional(),
  descripcion: IncidenciaBase.descripcion.optional(),
  severidad:   IncidenciaBase.severidad.optional(),
  fecha:       IncidenciaBase.fecha.optional(),
  status:      z.enum(['activo', 'completado', 'pausado', 'cancelado']).optional(),
})
