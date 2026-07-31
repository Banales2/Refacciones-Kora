import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/lotesService'

export async function loteDelete(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const antes = await capturar('lotes_pieza', id)
    await service.deleteLote(id)

    await audit({
      user,
      accion: 'ELIMINAR',
      tabla: 'lotes_pieza',
      registroId: id,
      antes,
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('lote-delete', {
  methods: ['DELETE'],
  route: 'lotes/{id}',
  authLevel: 'anonymous',
  handler: loteDelete,
})
