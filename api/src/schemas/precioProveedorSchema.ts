import { z } from 'zod'
import { TEXTO_LIBRE } from './common'

// Fecha local (no UTC) para no rechazar "hoy" en zonas horarias detrás de UTC.
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Cuándo se cotizó. No es la fecha de captura: se puede registrar hoy un precio
// que dieron la semana pasada, pero no uno del futuro.
const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
  .refine((v) => v <= todayIso(), 'No puede ser una fecha futura')

// Mismo tope que el costo unitario de una compra (loteSchema): es el precio de
// la misma refacción, solo que antes de comprarla.
const precio = z.coerce
  .number()
  .positive('Debe ser mayor a 0')
  .max(200000, 'No puede ser mayor a 200,000')

const observaciones = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim()
    .max(255, 'Máximo 255 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
    .nullable()
    .optional()
)

// `proveedor_id` no viaja en el cuerpo: va en la ruta.
// `registrado_por` tampoco: se toma del usuario de la sesión.
export const PrecioProveedorCreateSchema = z.object({
  pieza_id: z.coerce.number().int().min(1, 'Refacción requerida'),
  precio,
  fecha,
  observaciones,
})

// La refacción no se cambia al editar: un precio capturado contra otra pieza es
// otro registro. Se corrige el precio, la fecha o la nota.
export const PrecioProveedorUpdateSchema = z.object({
  precio: precio.optional(),
  fecha:  fecha.optional(),
  observaciones,
})

export type PrecioProveedorCreate = z.infer<typeof PrecioProveedorCreateSchema>
export type PrecioProveedorUpdate = z.infer<typeof PrecioProveedorUpdateSchema>
