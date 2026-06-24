import { z } from 'zod'

export const LoteCreateSchema = z.object({
  proveedor_id: z.coerce.number().int().min(1, 'Proveedor requerido'),
  fecha_compra: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)'),
  costo_unitario: z.coerce.number().positive('Debe ser mayor a 0'),
  cantidad_inicial: z.coerce.number().int().min(1, 'Mínimo 1 unidad'),
  num_factura: z.string().max(100).nullable().optional(),
})

export const LoteUpdateSchema = z.object({
  proveedor_id: z.coerce.number().int().min(1).optional(),
  fecha_compra: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  costo_unitario: z.coerce.number().positive().optional(),
  cantidad_inicial: z.coerce.number().int().min(1).optional(),
  num_factura: z.string().max(100).nullable().optional(),
})

export type LoteCreate = z.infer<typeof LoteCreateSchema>
export type LoteUpdate = z.infer<typeof LoteUpdateSchema>
