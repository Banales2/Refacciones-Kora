import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { DetalleMttoPiezaUpdateSchema } from '../schemas/detalleMttoPiezaSchema'
import * as service from '../services/detalleMttoPiezaService'

export async function detalleMttoUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = DetalleMttoPiezaUpdateSchema.parse(await req.json())
    const updated = await service.update(id, body)
    await audit({ user, accion: 'EDITAR', tabla: 'detalle_mtto_pieza', registroId: id, ipAddress: getClientIp(req) })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('detalle-mtto-update', {
  methods: ['PUT', 'PATCH'],
  route: 'detalle-mtto/{id}',
  authLevel: 'anonymous',
  handler: detalleMttoUpdate,
})
