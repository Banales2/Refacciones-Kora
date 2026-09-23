import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/piezasVehiculoService'

export async function vehiculoPiezasList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'lector', 'viewer')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const data = await service.getByVehiculo(id)
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('vehiculo-piezas-list', {
  methods: ['GET'],
  route: 'vehiculos/{id}/piezas',
  authLevel: 'anonymous',
  handler: vehiculoPiezasList,
})
