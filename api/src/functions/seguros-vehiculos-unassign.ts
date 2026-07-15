import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/segurosService'

export async function segurosVehiculosUnassign(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id         = parseInt(request.params.id, 10)
    const vehiculoId = parseInt(request.params.vehiculoId, 10)
    if (isNaN(id) || isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    await service.unassignVehiculo(id, vehiculoId)

    await audit({
      user, accion: 'EDITAR', tabla: 'seguros',
      registroId: id, detalles: { quitar_vehiculo: vehiculoId },
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('seguros-vehiculos-unassign', {
  methods: ['DELETE'],
  route: 'seguros/{id}/vehiculos/{vehiculoId}',
  authLevel: 'anonymous',
  handler: segurosVehiculosUnassign,
})
