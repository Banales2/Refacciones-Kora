import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as repo from '../repositories/pendientesRepo'

// Preventivos e incidencias activos de un vehículo, en una sola lista: es lo que
// un mantenimiento o una agenda pueden atender. Cada fila trae `origen` para que
// el front los agrupe.
export async function pendientesList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const data = await repo.findActivosByVehiculo(vehiculoId)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('pendientes-list', {
  methods: ['GET'],
  route: 'vehiculos/{vehiculoId}/pendientes',
  authLevel: 'anonymous',
  handler: pendientesList,
})
