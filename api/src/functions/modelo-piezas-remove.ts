import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/piezasModeloService'

export async function modeloPiezasRemove(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id      = parseInt(request.params.id, 10)
    const piezaId = parseInt(request.params.piezaId, 10)
    if (isNaN(id) || isNaN(piezaId)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    await service.removePieza(id, piezaId)

    await audit({
      user, accion: 'EDITAR', tabla: 'piezas_modelo',
      registroId: id, detalles: { quitar_pieza: piezaId },
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('modelo-piezas-remove', {
  methods: ['DELETE'],
  route: 'modelos/{id}/piezas/{piezaId}',
  authLevel: 'anonymous',
  handler: modeloPiezasRemove,
})
