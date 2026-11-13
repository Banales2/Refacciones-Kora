import { z } from 'zod'
import { CODIGO } from './common'

/**
 * El formato del folio de un vale: dos letras, guion y el número del talonario
 * ("TN-0001"); el número puede ser de cualquier largo. Se exige al crear y al
 * cambiar el folio, no a los vales que ya estaban: los de antes de la regla se
 * pueden seguir editando sin tocarles el folio. Espeja FOLIO_VALE del frontend.
 */
export const FOLIO_VALE = /^[A-Z]{2}-[0-9]+$/
export const FOLIO_VALE_MENSAJE = 'Dos letras, guion y el número (ej. TN-0001)'

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
// `folioLibre` es el de antes de FOLIO_VALE: lo admite la edición, y el
// servicio exige el formato solo si el folio cambia.
const folioLibre = z
  .string()
  .trim()
  .min(1, 'Folio requerido')
  .max(30, 'Máximo 30 caracteres')
  .regex(CODIGO, 'Solo mayúsculas, números y guiones')

const folio = folioLibre.regex(FOLIO_VALE, FOLIO_VALE_MENSAJE)

// `creado_por` es opcional: sin él, el vale queda a nombre de quien tiene la
// sesión. Con él, quien captura registra el vale que le pasó otra persona —el
// papel lo entregó ella—, pero solo a nombre de una cuenta dada de alta: el
// servicio lo valida contra `usuarios`, y la bitácora guarda quién lo capturó.
// `sucursal_id` es opcional aquí porque a quien está acotado a una sucursal se
// la pone la API; a los demás se la exige la función (ver vales-gasolina-create).
export const ValeGasolinaCreateSchema = z.object({
  folio,
  conductor_id: z.coerce.number().int().min(1, 'Chofer requerido'),
  vehiculo_id:  z.coerce.number().int().min(1, 'Vehículo requerido'),
  sucursal_id:  z.coerce.number().int().min(1, 'Sucursal requerida').optional(),
  fecha,
  creado_por:   z.string().trim().min(1).max(120).optional(),
})

export const ValeGasolinaUpdateSchema = z.object({
  folio: folioLibre.optional(),
  conductor_id: z.coerce.number().int().min(1, 'Chofer requerido').optional(),
  vehiculo_id:  z.coerce.number().int().min(1, 'Vehículo requerido').optional(),
  // Sirve también para ponerle sucursal a un vale ANTIGUO.
  sucursal_id:  z.coerce.number().int().min(1, 'Sucursal requerida').optional(),
  fecha: fecha.optional(),
})

export type ValeGasolinaCreate = z.infer<typeof ValeGasolinaCreateSchema>
export type ValeGasolinaUpdate = z.infer<typeof ValeGasolinaUpdateSchema>
