import { z } from 'zod'

export const TIPOS_VEHICULO = ['camion', 'tractocamion', 'caja_trailer', 'utilitario'] as const
export type TipoVehiculo = typeof TIPOS_VEHICULO[number]

export const VehiculoQuerySchema = z.object({
  page:      z.coerce.number().int().min(1).default(1),
  pageSize:  z.coerce.number().int().min(1).max(100).default(20),
  search:    z.string().max(100).optional(),
  tipo:      z.enum(TIPOS_VEHICULO).optional(),
  modelo_id: z.coerce.number().int().positive().optional(),
})

export const VehiculoCreateSchema = z.object({
  tipo:        z.enum(TIPOS_VEHICULO),
  vehiculo:    z.string().min(1, 'Requerido').max(120).trim(),
  modelo_id:   z.coerce.number().int().min(1, 'Requerido'),
  serie:       z.string().min(1, 'Requerido').max(80).trim(),
  // camion + tractocamion + utilitario
  combustible: z.string().max(30).trim().optional(),
  // camion + tractocamion
  kilometraje: z.coerce.number().int().min(0).optional(),
  status:      z.string().max(30).trim().optional(),
  // camion
  ubicacion:   z.string().max(200).trim().nullable().optional(),
  sucursal_id: z.coerce.number().int().positive().optional(),
  // tractocamion
  tonelaje:    z.coerce.number().int().positive().optional(),
  tenencia:    z.string().max(50).trim().nullable().optional(),
  ruta_id:     z.coerce.number().int().positive().optional(),
  // caja_trailer
  pies:         z.coerce.number().int().positive().optional(),
  // general
  fecha_compra: z.string().date().nullable().optional(),
})

export const VehiculoUpdateSchema = z.object({
  vehiculo:     z.string().min(1).max(120).trim().optional(),
  modelo_id:    z.coerce.number().int().min(1).optional(),
  serie:        z.string().min(1).max(80).trim().optional(),
  combustible:  z.string().max(30).trim().optional(),
  kilometraje:  z.coerce.number().int().min(0).optional(),
  status:       z.string().max(30).trim().optional(),
  ubicacion:    z.string().max(200).trim().nullable().optional(),
  sucursal_id:  z.coerce.number().int().positive().optional(),
  tonelaje:     z.coerce.number().int().positive().optional(),
  tenencia:     z.string().max(50).trim().nullable().optional(),
  ruta_id:      z.coerce.number().int().positive().optional(),
  pies:         z.coerce.number().int().positive().optional(),
  fecha_compra: z.string().date().nullable().optional(),
})

export type VehiculoQuery  = z.infer<typeof VehiculoQuerySchema>
export type VehiculoCreate = z.infer<typeof VehiculoCreateSchema>
export type VehiculoUpdate = z.infer<typeof VehiculoUpdateSchema>
