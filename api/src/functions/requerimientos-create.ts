import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/requerimentosService'
import { TEXTO_SIMPLE, TEXTO_LIBRE, KM_MAX } from '../schemas/common'

const Schema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(40, 'Máximo 40 caracteres')
    .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones'),
  descripcion: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(255, 'Máximo 255 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos'),
  categoria: z
    .string()
    .trim()
    .max(30, 'Máximo 30 caracteres')
    .refine((v) => v === '' || TEXTO_SIMPLE.test(v), 'Solo letras, números, espacios y guiones')
    .nullable()
    .optional(),
  trigger_mode:    z.enum(['km', 'meses', 'ambos']),
  intervalo_km:    z.coerce.number().int().positive().max(KM_MAX, 'Máximo 9,999,999 km').nullable().optional(),
  intervalo_meses: z.coerce.number().int().positive().nullable().optional(),
  status:          z.enum(['activo', 'completado', 'pausado', 'cancelado']).default('activo'),
  fecha_inicio:    z.string().date().nullable().optional(),
  km_inicio:       z.coerce.number().int().min(0).max(KM_MAX, 'Máximo 9,999,999 km').nullable().optional(),
  fecha_reporte:   z.string().date().nullable().optional(),
})

export async function requerimientosCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const body = Schema.parse(await req.json())
    const created = await service.create(vehiculoId, body)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'requerimientos_exclusivos',
      registroId: created.id,
      despues: await capturar('requerimientos_exclusivos', created.id),
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('requerimientos-create', {
  methods: ['POST'],
  route: 'vehiculos/{vehiculoId}/requerimientos',
  authLevel: 'anonymous',
  handler: requerimientosCreate,
})
