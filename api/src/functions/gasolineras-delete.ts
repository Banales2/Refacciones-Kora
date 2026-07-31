import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/gasolinerasService'

export async function gasolinerasDelete(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const antes = await capturar('gasolineras', id)
    await service.remove(id)

    await audit({
      user,
      accion: 'ELIMINAR',
      tabla: 'gasolineras',
      registroId: id,
      antes,
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('gasolineras-delete', {
  methods: ['DELETE'],
  route: 'gasolineras/{id}',
  authLevel: 'anonymous',
  handler: gasolinerasDelete,
})
