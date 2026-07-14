import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/recargasService'

export async function recargasList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'lector', 'viewer')
    const vehiculoId = parseInt(request.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
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
