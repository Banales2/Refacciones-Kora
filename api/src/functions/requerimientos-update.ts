import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/requerimentosService'

const Schema = z.object({
  nombre:          z.string().min(1).max(120).trim().optional(),
  descripcion:     z.string().max(5000).trim().nullable().optional(),
  categoria:       z.string().max(80).trim().nullable().optional(),
  trigger_mode:    z.enum(['km', 'meses', 'ambos']).optional(),
  tipo:            z.enum(['recurrente', 'unica']).optional(),
  intervalo_km:    z.coerce.number().int().positive().nullable().optional(),
  intervalo_meses: z.coerce.number().int().positive().nullable().optional(),
  status:          z.enum(['activo', 'completado', 'pausado', 'cancelado']).optional(),
  fecha_inicio:    z.string().date().nullable().optional(),
  km_inicio:       z.coerce.number().int().min(0).nullable().optional(),
})

export async function requerimientosUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = Schema.parse(await req.json())
    const updated = await service.update(id, body)
    await audit({ user, accion: 'EDITAR', tabla: 'requerimientos_exclusivos', registroId: id, ipAddress: getClientIp(req) })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('requerimientos-update', {
  methods: ['PUT', 'PATCH'],
  route: 'requerimientos/{id}',
  authLevel: 'anonymous',
  handler: requerimientosUpdate,
})
