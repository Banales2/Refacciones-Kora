import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/rutasService'

export async function rutasDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    await service.remove(id)
    await audit({ user, accion: 'ELIMINAR', tabla: 'rutas', registroId: id, ipAddress: getClientIp(req) })
    return { status: 204 }
  } catch (err) { return handleError(err, ctx) }
}

app.http('rutas-delete', { methods: ['DELETE'], route: 'rutas/{id}', authLevel: 'anonymous', handler: rutasDelete })
