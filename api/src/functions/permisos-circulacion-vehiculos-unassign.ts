import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/permisosCirculacionService'

export async function permisosCirculacionVehiculosUnassign(
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
      user, accion: 'EDITAR', tabla: 'permisos_circulacion',
      registroId: id, detalles: { quitar_vehiculo: vehiculoId },
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('permisos-circulacion-vehiculos-unassign', {
  methods: ['DELETE'],
  route: 'permisos-circulacion/{id}/vehiculos/{vehiculoId}',
  authLevel: 'anonymous',
  handler: permisosCirculacionVehiculosUnassign,
})
