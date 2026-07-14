import { z } from 'zod'

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
  costo_unitario: z.coerce.number().positive('Debe ser mayor a 0'),
  cantidad_inicial: z.coerce.number().int().min(1, 'Mínimo 1 unidad'),
  num_factura: z.string().max(100).nullable().optional(),
})

export const LoteUpdateSchema = z.object({
  proveedor_id: z.coerce.number().int().min(1).optional(),
  fecha_compra: fechaCompra.optional(),
  costo_unitario: z.coerce.number().positive().optional(),
  cantidad_inicial: z.coerce.number().int().min(1).optional(),
  num_factura: z.string().max(100).nullable().optional(),
})

export type LoteCreate = z.infer<typeof LoteCreateSchema>
export type LoteUpdate = z.infer<typeof LoteUpdateSchema>
