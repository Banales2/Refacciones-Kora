import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/plantillaService'

const Schema = z.object({
  nombre:          z.string().min(1, 'Requerido').max(120).trim(),
  descripcion:     z.string().max(5000).trim().nullable().optional(),
  categoria:       z.string().max(80).trim().nullable().optional(),
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
