import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, exigirVehiculo } from '../shared/alcance'
import * as service from '../services/recargasService'

export async function recargasList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor', 'lector', 'viewer', 'responsable')
    const vehiculoId = parseInt(request.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    await exigirVehiculo(vehiculoId, await alcanceDe(user))
    const data = await service.getByVehiculo(vehiculoId)
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('recargas-list', {
  methods: ['GET'],
  route: 'vehiculos/{vehiculoId}/recargas',
  authLevel: 'anonymous',
  handler: recargasList,
})
