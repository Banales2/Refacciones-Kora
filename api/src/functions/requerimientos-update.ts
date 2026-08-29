import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/requerimentosService'
import { TEXTO_SIMPLE, TEXTO_LIBRE, KM_MAX } from '../schemas/common'
import { GarantiaIdsSchema } from '../schemas/garantiaSchema'

const Schema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(40, 'Máximo 40 caracteres')
    .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones')
    .optional(),
  descripcion: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(255, 'Máximo 255 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
    .optional(),
  categoria: z
    .string()
    .trim()
    .max(30, 'Máximo 30 caracteres')
    .refine((v) => v === '' || TEXTO_SIMPLE.test(v), 'Solo letras, números, espacios y guiones')
    .nullable()
    .optional(),
  trigger_mode:    z.enum(['km', 'meses', 'ambos']).optional(),
  intervalo_km:    z.coerce.number().int().positive().max(KM_MAX, 'Máximo 9,999,999 km').nullable().optional(),
  intervalo_meses: z.coerce.number().int().positive().nullable().optional(),
  // Ver la nota del alta: 'completado' no aplica a un preventivo.
  status:          z.enum(['activo', 'pausado', 'cancelado']).optional(),
  fecha_inicio:    z.string().date().nullable().optional(),
  km_inicio:       z.coerce.number().int().min(0).max(KM_MAX, 'Máximo 9,999,999 km').nullable().optional(),
  fecha_reporte:   z.string().date().nullable().optional(),
  // Ausente = no se tocan las garantías atadas; [] = se desatan todas.
  garantia_ids:    GarantiaIdsSchema,
})

export async function requerimientosUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const { garantia_ids, ...body } = Schema.parse(await req.json())
    const antes = await capturar('requerimientos_exclusivos', id)
    const updated = await service.update(id, body, garantia_ids)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'requerimientos_exclusivos',
      registroId: id,
      antes,
      despues: await capturar('requerimientos_exclusivos', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('requerimientos-update', {
  methods: ['PUT', 'PATCH'],
  route: 'requerimientos/{id}',
  authLevel: 'anonymous',
  handler: requerimientosUpdate,
})
