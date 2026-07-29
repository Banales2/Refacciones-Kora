import { z } from 'zod'

// Fecha local (no UTC) para no rechazar "hoy" en zonas horarias detrás de UTC.
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
  .refine((v) => v <= todayIso(), 'No puede ser una fecha futura')

// `creado_por` no se recibe del cliente: se toma del usuario de la sesión para
// que el vale no pueda registrarse a nombre de otra persona.
export const ValeGasolinaCreateSchema = z.object({
  conductor_id: z.coerce.number().int().min(1, 'Chofer requerido'),
  vehiculo_id:  z.coerce.number().int().min(1, 'Vehículo requerido'),
  fecha,
})

export const ValeGasolinaUpdateSchema = z.object({
  conductor_id: z.coerce.number().int().min(1, 'Chofer requerido').optional(),
  vehiculo_id:  z.coerce.number().int().min(1, 'Vehículo requerido').optional(),
  fecha: fecha.optional(),
})

export type ValeGasolinaCreate = z.infer<typeof ValeGasolinaCreateSchema>
export type ValeGasolinaUpdate = z.infer<typeof ValeGasolinaUpdateSchema>
