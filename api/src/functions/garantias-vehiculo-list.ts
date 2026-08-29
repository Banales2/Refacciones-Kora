// Garantías de una unidad, con su vigencia ya calculada: cuánto le queda por
// tiempo y por kilometraje, y si ya se acabó o alguien la canceló.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/garantiasService'

export async function garantiasVehiculoList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector', 'viewer')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const data = await service.getByVehiculo(vehiculoId)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('garantias-vehiculo-list', {
  methods: ['GET'],
  route: 'vehiculos/{vehiculoId}/garantias',
  authLevel: 'anonymous',
  handler: garantiasVehiculoList,
})
