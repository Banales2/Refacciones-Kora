import { z } from 'zod'
import { TEXTO_LIBRE } from './common'

// Fecha local (no UTC) para no rechazar "hoy" en zonas horarias detrás de UTC.
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const observaciones = z
  .string()
  .trim()
  .max(300, 'Máximo 300 caracteres')
  .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
  .nullish()

export const TraspasoCreateSchema = z.object({
  lote_id:             z.coerce.number().int().min(1, 'Lote requerido'),
  origen_sucursal_id:  z.coerce.number().int().min(1, 'Sucursal de origen requerida'),
  destino_sucursal_id: z.coerce.number().int().min(1, 'Sucursal de destino requerida'),
  cantidad:            z.coerce.number().int().min(1, 'Mínimo 1 unidad'),
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
    .refine((v) => v <= todayIso(), 'No puede ser una fecha futura'),
  observaciones,
})
  // Se valida aquí y no solo en la base para poder dar el mensaje en español;
  // el CHECK de la tabla queda como red por si algo entra por otro camino.
  .refine((d) => d.origen_sucursal_id !== d.destino_sucursal_id, {
    message: 'El origen y el destino no pueden ser la misma sucursal',
    path: ['destino_sucursal_id'],
  })

export const MinimoCreateSchema = z.object({
  sucursal_id: z.coerce.number().int().min(1, 'Sucursal requerida'),
  pieza_id:    z.coerce.number().int().min(1, 'Refacción requerida'),
  minimo:      z.coerce.number().int().min(1, 'Mínimo 1 unidad').max(999, 'Máximo 999'),
  observaciones,
})

export const MinimoUpdateSchema = z.object({
  minimo:       z.coerce.number().int().min(1, 'Mínimo 1 unidad').max(999, 'Máximo 999').optional(),
  observaciones,
})

export type TraspasoCreate = z.infer<typeof TraspasoCreateSchema>
export type MinimoCreate   = z.infer<typeof MinimoCreateSchema>
export type MinimoUpdate   = z.infer<typeof MinimoUpdateSchema>
