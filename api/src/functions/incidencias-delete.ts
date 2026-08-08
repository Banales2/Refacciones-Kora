import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/incidenciasService'

export async function incidenciasDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const antes = await capturar('incidencias', id)
    await service.remove(id)
    await audit({
      user,
      accion: 'ELIMINAR',
      tabla: 'incidencias',
      registroId: id,
      antes,
      ipAddress: getClientIp(req),
    })
    return { status: 204 }
  } catch (err) { return handleError(err, ctx) }
}

app.http('incidencias-delete', {
  methods: ['DELETE'],
  route: 'incidencias/{id}',
  authLevel: 'anonymous',
  handler: incidenciasDelete,
})
