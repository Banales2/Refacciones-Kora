import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/detalleMttoPiezaService'

export async function detalleMttoDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    await service.remove(id)
    await audit({ user, accion: 'ELIMINAR', tabla: 'detalle_mtto_pieza', registroId: id, ipAddress: getClientIp(req) })
    return { status: 204 }
  } catch (err) { return handleError(err, ctx) }
}

app.http('detalle-mtto-delete', {
  methods: ['DELETE'],
  route: 'detalle-mtto/{id}',
  authLevel: 'anonymous',
  handler: detalleMttoDelete,
})
