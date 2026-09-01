// El programa de mantenimiento visto desde la unidad: en qué punto del
// recorrido va, qué le toca en la próxima visita y qué renglones se le
// vencieron por tiempo. `data: null` = la unidad no sigue ningún programa.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/programaVehiculoService'

export async function vehiculoProgramaGet(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    return { status: 200, jsonBody: { data: await service.getEstado(vehiculoId) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculo-programa-get', {
  methods: ['GET'],
  route: 'vehiculos/{vehiculoId}/programa',
  authLevel: 'anonymous',
  handler: vehiculoProgramaGet,
})
