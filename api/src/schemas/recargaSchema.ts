import { z } from 'zod'
import { KM_MAX } from './common'

// Fecha local (no UTC) para no rechazar "hoy" en zonas horarias detrás de UTC.
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
  .refine((v) => v <= todayIso(), 'No puede ser una fecha futura')

export const RecargaCreateSchema = z.object({
  gasolinera_id: z.coerce.number().int().min(1, 'Gasolinera requerida'),
  conductor_id:  z.coerce.number().int().min(1, 'Conductor requerido'),
  // Obligatorio al registrar. Las recargas anteriores a esta función se
  // quedaron sin vale y por eso la columna sigue siendo NULL-able en la tabla.
  vale_id: z.coerce.number().int().min(1, 'Vale requerido'),
  fecha,
  litros: z.coerce.number().positive('Debe ser mayor a 0'),
  costo:  z.coerce.number().min(0, 'No puede ser negativo'),
  kilometraje: z.coerce.number().int().min(0, 'No puede ser negativo').max(KM_MAX, 'Máximo 9,999,999 km'),
})

export const RecargaUpdateSchema = z.object({
  gasolinera_id: z.coerce.number().int().min(1).optional(),
  conductor_id:  z.coerce.number().int().min(1).optional(),
  vale_id:       z.coerce.number().int().min(1, 'Vale requerido').optional(),
  fecha:  fecha.optional(),
  litros: z.coerce.number().positive('Debe ser mayor a 0').optional(),
  costo:  z.coerce.number().min(0, 'No puede ser negativo').optional(),
  kilometraje: z.coerce.number().int().min(0, 'No puede ser negativo').max(KM_MAX, 'Máximo 9,999,999 km').optional(),
})

export type RecargaCreate = z.infer<typeof RecargaCreateSchema>
export type RecargaUpdate = z.infer<typeof RecargaUpdateSchema>
