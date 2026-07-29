import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/tecnicosService'

export async function tecnicosDelete(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    await service.remove(id)

    await audit({
      user, accion: 'ELIMINAR', tabla: 'tecnicos',
      registroId: id, ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('tecnicos-delete', {
  methods: ['DELETE'],
  route: 'tecnicos/{id}',
  authLevel: 'anonymous',
  handler: tecnicosDelete,
})
