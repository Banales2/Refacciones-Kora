import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, exigirVehiculo } from '../shared/alcance'
import * as service from '../services/chequeosService'

// El historial de chequeos de una unidad, para su ficha.
export async function chequeosVehiculoList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'lector', 'responsable')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    await exigirVehiculo(vehiculoId, await alcanceDe(user))
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
