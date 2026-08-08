import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/incidenciasService'

export async function incidenciasListVehiculo(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const data = await service.getByVehiculo(vehiculoId)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('incidencias-list-vehiculo', {
  methods: ['GET'],
  route: 'vehiculos/{vehiculoId}/incidencias',
  authLevel: 'anonymous',
  handler: incidenciasListVehiculo,
})
