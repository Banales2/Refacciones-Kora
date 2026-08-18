import { z } from 'zod'

export const DetalleMttoPiezaCreateSchema = z.object({
  lote_id:        z.coerce.number().int().min(1, 'Lote requerido'),
  // De qué sucursal sale la pieza. El mismo lote puede estar repartido entre
  // varias, así que el lote solo no basta para saber de dónde descontar.
  sucursal_id:    z.coerce.number().int().min(1, 'Sucursal requerida'),
  cantidad:       z.coerce.number().int().min(1, 'Mínimo 1 unidad'),
  costo_unitario: z.coerce.number().positive().optional(),
})

export const DetalleMttoPiezaUpdateSchema = z.object({
  cantidad:       z.coerce.number().int().min(1).optional(),
  costo_unitario: z.coerce.number().positive().optional(),
})

export type DetalleMttoPiezaCreate = z.infer<typeof DetalleMttoPiezaCreateSchema>
export type DetalleMttoPiezaUpdate = z.infer<typeof DetalleMttoPiezaUpdateSchema>
