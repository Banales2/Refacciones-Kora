import { z } from 'zod'
import { CODIGO, KM_MAX } from './common'

export const TIPOS_VEHICULO = ['camion', 'tractocamion', 'caja_trailer', 'utilitario', 'montacargas'] as const
export type TipoVehiculo = typeof TIPOS_VEHICULO[number]

// Motivos por los que una unidad necesita atención, para poder listarlas desde
// la búsqueda. Los dos primeros son documentos que nunca se capturaron; los
// otros dos, cosas que ya vencieron o están por vencer. Las unidades dadas de
// baja quedan fuera de todos: ya no se les va a capturar ni renovar nada.
export const ALERTAS_VEHICULO = [
  'sin_tenencia', 'sin_seguro', 'requerimientos_vencidos', 'permiso_por_vencer',
] as const
export type AlertaVehiculo = typeof ALERTAS_VEHICULO[number]

export const VehiculoQuerySchema = z.object({
  page:      z.coerce.number().int().min(1).default(1),
  pageSize:  z.coerce.number().int().min(1).max(100).default(20),
  search:    z.string().max(100).optional(),
  tipo:      z.enum(TIPOS_VEHICULO).optional(),
  modelo_id: z.coerce.number().int().positive().optional(),
  alerta:    z.enum(ALERTAS_VEHICULO).optional(),
})

export const VehiculoCreateSchema = z.object({
  tipo:        z.enum(TIPOS_VEHICULO),
  modelo_id:   z.coerce.number().int().min(1, 'Requerido'),
  serie: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(20, 'Máximo 20 caracteres')
    .regex(CODIGO, 'Solo mayúsculas, números y guiones'),
  placas: z
    .string()
    .trim()
    .max(10, 'Máximo 10 caracteres')
    .refine((v) => v === '' || CODIGO.test(v), 'Solo mayúsculas, números y guiones')
    .nullable()
    .optional(),
  // camion + tractocamion + utilitario + montacargas
  combustible: z.string().max(30).trim().optional(),
  // camion + tractocamion + utilitario
  kilometraje: z.coerce.number().int().min(0).max(KM_MAX, 'Máximo 9,999,999 km').optional(),
  status:      z.string().max(30).trim().optional(),
  // camion + montacargas
  ubicacion:   z.string().max(200).trim().nullable().optional(),
  sucursal_id: z.coerce.number().int().positive().optional(),
  // camion + tractocamion + utilitario: los únicos que pagan tenencia.
  tenencia:            z.string().max(50).trim().nullable().optional(),
  tenencia_expiracion: z.string().date().nullable().optional(),
  // tractocamion
  tonelaje:    z.coerce.number().int().positive().optional(),
  ruta_id:     z.coerce.number().int().positive().optional(),
  // caja_trailer
  pies:         z.coerce.number().int().positive().optional(),
  // general
  fecha_compra: z.string({ error: 'Fecha de compra requerida' }).date(),
  seguro_id:    z.coerce.number().int().positive().nullable().optional(),
  permiso_id:   z.coerce.number().int().positive().nullable().optional(),
})
  // Los montacargas no llevan placas; el resto de los tipos sí.
  .superRefine((data, ctx) => {
    if (data.tipo !== 'montacargas' && !data.placas?.trim()) {
      ctx.addIssue({ code: 'custom', message: 'Placas requeridas', path: ['placas'] })
    }
  })

export const VehiculoUpdateSchema = z.object({
  modelo_id:    z.coerce.number().int().min(1).optional(),
  serie: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(20, 'Máximo 20 caracteres')
    .regex(CODIGO, 'Solo mayúsculas, números y guiones')
    .optional(),
  placas: z
    .string()
    .trim()
    .max(10, 'Máximo 10 caracteres')
    .refine((v) => v === '' || CODIGO.test(v), 'Solo mayúsculas, números y guiones')
    .nullable()
    .optional(),
  combustible:  z.string().max(30).trim().optional(),
  kilometraje:  z.coerce.number().int().min(0).max(KM_MAX, 'Máximo 9,999,999 km').optional(),
  status:       z.string().max(30).trim().optional(),
  ubicacion:    z.string().max(200).trim().nullable().optional(),
  sucursal_id:  z.coerce.number().int().positive().optional(),
  tonelaje:     z.coerce.number().int().positive().optional(),
  tenencia:            z.string().max(50).trim().nullable().optional(),
  tenencia_expiracion: z.string().date().nullable().optional(),
  ruta_id:      z.coerce.number().int().positive().optional(),
  pies:         z.coerce.number().int().positive().optional(),
  fecha_compra: z.string().date().nullable().optional(),
  seguro_id:    z.coerce.number().int().positive().nullable().optional(),
  permiso_id:   z.coerce.number().int().positive().nullable().optional(),
})

export type VehiculoQuery  = z.infer<typeof VehiculoQuerySchema>
export type VehiculoCreate = z.infer<typeof VehiculoCreateSchema>
export type VehiculoUpdate = z.infer<typeof VehiculoUpdateSchema>
