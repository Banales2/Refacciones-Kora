import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/plantillaService'
import { TEXTO_SIMPLE, TEXTO_LIBRE } from '../schemas/common'

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
    .min(1, 'Requerido')
    .max(30, 'Máximo 30 caracteres')
    .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones'),
  trigger_mode:    z.enum(['km', 'meses', 'ambos']),
  tipo:            z.enum(['recurrente', 'unica']).default('recurrente'),
  intervalo_km:    z.coerce.number().int().positive().nullable().optional(),
  intervalo_meses: z.coerce.number().int().positive().nullable().optional(),
  activo:          z.boolean().default(true),
})

export async function plantillaCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const modeloId = parseInt(req.params.modeloId, 10)
    if (isNaN(modeloId)) return { status: 400, jsonBody: { error: 'ID de modelo inválido' } }
    const body = Schema.parse(await req.json())
    const created = await service.create(modeloId, body)
    await audit({ user, accion: 'CREAR', tabla: 'plantilla_requerimientos_modelo', registroId: created.id, ipAddress: getClientIp(req) })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('plantilla-create', {
  methods: ['POST'],
  route: 'modelos/{modeloId}/plantilla',
  authLevel: 'anonymous',
  handler: plantillaCreate,
})
