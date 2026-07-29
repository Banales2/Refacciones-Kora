import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/piezasVehiculoService'

export async function vehiculoPiezasRemove(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id     = parseInt(request.params.id, 10)
    const tipoId = parseInt(request.params.tipoId, 10)
    if (isNaN(id) || isNaN(tipoId)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    await service.removePieza(id, tipoId)

    await audit({
      user, accion: 'EDITAR', tabla: 'piezas_vehiculo',
      registroId: id, detalles: { quitar_tipo: tipoId },
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('vehiculo-piezas-remove', {
  methods: ['DELETE'],
  route: 'vehiculos/{id}/piezas/{tipoId}',
  authLevel: 'anonymous',
  handler: vehiculoPiezasRemove,
})
