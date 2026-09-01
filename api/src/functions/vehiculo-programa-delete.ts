import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/programaVehiculoService'

export async function vehiculoProgramaDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    await service.quitar(vehiculoId)
    await audit({
      user,
      accion: 'ELIMINAR',
      tabla: 'vehiculo_programa',
      registroId: vehiculoId,
      ipAddress: getClientIp(req),
    })
    return { status: 204 }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculo-programa-delete', {
  methods: ['DELETE'],
  route: 'vehiculos/{vehiculoId}/programa',
  authLevel: 'anonymous',
  handler: vehiculoProgramaDelete,
})
