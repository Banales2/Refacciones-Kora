import { z } from 'zod'
import { TEXTO_SIMPLE } from './common'

// Quién hizo la compra. Es un empleado, no un catálogo: texto libre acotado.
// `autorizado_por` no aparece en ningún schema a propósito: no se recibe del
// cliente ni se edita, la API lo toma de la cuenta que registra el lote.
const compradoPor = z
  .string()
  .trim()
  .min(1, 'Requerido')
  .max(120, 'Máximo 120 caracteres')
  .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones')

// Fecha local (no UTC) para no rechazar "hoy" en zonas horarias detrás de UTC.
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fechaCompra = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
  .refine((v) => v <= todayIso(), 'No puede ser una fecha futura')

export const LoteCreateSchema = z.object({
  proveedor_id: z.coerce.number().int().min(1, 'Proveedor requerido'),
  fecha_compra: fechaCompra,
  costo_unitario: z.coerce
    .number()
    .positive('Debe ser mayor a 0')
    .max(200000, 'No puede ser mayor a 200,000'),
  cantidad_inicial: z.coerce
    .number()
    .int()
    .min(1, 'Mínimo 1 unidad')
    .max(999, 'Máximo 999 unidades'),
  num_factura: z
    .string()
    .trim()
    .min(1, 'Núm. factura requerido')
    .max(30, 'Máximo 30 caracteres')
    .regex(/^[A-Za-z0-9-]+$/, 'Solo letras, números y guiones'),
  comprado_por: compradoPor,
})

export const LoteUpdateSchema = z.object({
  proveedor_id: z.coerce.number().int().min(1).optional(),
  fecha_compra: fechaCompra.optional(),
  costo_unitario: z.coerce
    .number()
    .positive('Debe ser mayor a 0')
    .max(200000, 'No puede ser mayor a 200,000')
    .optional(),
  cantidad_inicial: z.coerce
    .number()
    .int()
    .min(1, 'Mínimo 1 unidad')
    .max(999, 'Máximo 999 unidades')
    .optional(),
  num_factura: z
    .string()
    .trim()
    .min(1, 'Núm. factura requerido')
    .max(30, 'Máximo 30 caracteres')
    .regex(/^[A-Za-z0-9-]+$/, 'Solo letras, números y guiones')
    .optional(),
  comprado_por: compradoPor.optional(),
})

export type LoteCreate = z.infer<typeof LoteCreateSchema>
export type LoteUpdate = z.infer<typeof LoteUpdateSchema>
