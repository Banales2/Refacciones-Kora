import { z } from 'zod'
import { CODIGO } from './common'

// Fecha local (no UTC) para no rechazar "hoy" en zonas horarias detrás de UTC.
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
  .refine((v) => v <= todayIso(), 'No puede ser una fecha futura')

// Folio impreso del vale. Es el numero del papel, asi que se captura tal cual y
// no se genera: obligatorio y unico (la unicidad la sostiene un indice y se
// verifica en el servicio para poder contestar con un mensaje claro).
const folio = z
  .string()
  .trim()
  .min(1, 'Folio requerido')
  .max(30, 'Máximo 30 caracteres')
  .regex(CODIGO, 'Solo mayúsculas, números y guiones')

// `creado_por` no se recibe del cliente: se toma del usuario de la sesión para
// que el vale no pueda registrarse a nombre de otra persona.
export const ValeGasolinaCreateSchema = z.object({
  folio,
  conductor_id: z.coerce.number().int().min(1, 'Chofer requerido'),
  vehiculo_id:  z.coerce.number().int().min(1, 'Vehículo requerido'),
  fecha,
})

export const ValeGasolinaUpdateSchema = z.object({
  folio: folio.optional(),
  conductor_id: z.coerce.number().int().min(1, 'Chofer requerido').optional(),
  vehiculo_id:  z.coerce.number().int().min(1, 'Vehículo requerido').optional(),
  fecha: fecha.optional(),
})

export type ValeGasolinaCreate = z.infer<typeof ValeGasolinaCreateSchema>
export type ValeGasolinaUpdate = z.infer<typeof ValeGasolinaUpdateSchema>
