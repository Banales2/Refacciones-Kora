import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/tiposPiezaModeloService'

export async function modeloTiposPiezaRemove(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id     = parseInt(request.params.id, 10)
    const tipoId = parseInt(request.params.tipoId, 10)
    if (isNaN(id) || isNaN(tipoId)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    await service.removeTipo(id, tipoId)

    await audit({
      user, accion: 'EDITAR', tabla: 'tipos_pieza_modelo',
      registroId: id, detalles: { quitar_tipo: tipoId },
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('modelo-tipos-pieza-remove', {
  methods: ['DELETE'],
  route: 'modelos/{id}/tipos-pieza/{tipoId}',
  authLevel: 'anonymous',
  handler: modeloTiposPiezaRemove,
})
