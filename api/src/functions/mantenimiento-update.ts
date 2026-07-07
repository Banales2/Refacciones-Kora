import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/mantenimientoService'

const Schema = z.object({
  fecha:             z.string().date().optional(),
  tipo:              z.string().max(80).trim().nullable().optional(),
  tecnico:           z.string().max(120).trim().nullable().optional(),
  costo:             z.coerce.number().int().min(0).optional(),
  km_actual:         z.coerce.number().int().min(0).optional(),
  observaciones:     z.string().trim().nullable().optional(),
  requerimiento_ids: z.array(z.number().int().positive()).optional(),
})

export async function mantenimientoUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = Schema.parse(await req.json())
    const updated = await service.update(id, body)
    await audit({ user, accion: 'EDITAR', tabla: 'mantenimiento', registroId: id, ipAddress: getClientIp(req) })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('mantenimiento-update', {
  methods: ['PUT'],
  route: 'mantenimientos/{id}',
  authLevel: 'anonymous',
  handler: mantenimientoUpdate,
})
