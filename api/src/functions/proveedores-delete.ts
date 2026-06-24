import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/proveedoresService'

export async function proveedoresDelete(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    await service.remove(id)
    await audit({
      user, accion: 'ELIMINAR', tabla: 'proveedores',
      registroId: id, ipAddress: getClientIp(request),
    })
    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('proveedores-delete', {
  methods: ['DELETE'],
  route: 'proveedores/{id}',
  authLevel: 'anonymous',
  handler: proveedoresDelete,
})
