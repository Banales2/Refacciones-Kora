import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/chequeosService'

// El historial de chequeos de una unidad, para su ficha.
export async function chequeosVehiculoList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const data = await service.getByVehiculo(vehiculoId)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('chequeos-vehiculo-list', {
  methods: ['GET'],
  route: 'vehiculos/{vehiculoId}/chequeos',
  authLevel: 'anonymous',
  handler: chequeosVehiculoList,
})
