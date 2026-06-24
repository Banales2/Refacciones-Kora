import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/modelosService'

export async function modelosDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    await service.remove(id)
    await audit({ user, accion: 'ELIMINAR', tabla: 'modelos', registroId: id, ipAddress: getClientIp(req) })
    return { status: 204 }
  } catch (err) { return handleError(err, ctx) }
}

app.http('modelos-delete', { methods: ['DELETE'], route: 'modelos/{id}', authLevel: 'anonymous', handler: modelosDelete })
