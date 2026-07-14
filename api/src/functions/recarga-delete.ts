import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/recargasService'

export async function recargaDelete(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    await service.remove(id)

    await audit({
      user, accion: 'ELIMINAR', tabla: 'recargas_combustible',
      registroId: id, ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('recarga-delete', {
  methods: ['DELETE'],
  route: 'recargas/{id}',
  authLevel: 'anonymous',
  handler: recargaDelete,
})
