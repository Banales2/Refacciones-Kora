import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/tiposPiezaService'

export async function tiposPiezaDelete(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const antes = await capturar('tipos_pieza', id)
    await service.remove(id)

    await audit({
      user,
      accion: 'ELIMINAR',
      tabla: 'tipos_pieza',
      registroId: id,
      antes,
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('tipos-pieza-delete', {
  methods: ['DELETE'],
  route: 'tipos-pieza/{id}',
  authLevel: 'anonymous',
  handler: tiposPiezaDelete,
})
