import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardService'

// Lo que el almacén tiene sin resolver y no alerta solo: traspasos en camino
// esperando que el destino los acepte, y refacciones a las que falta capturarles
// la marca.
export async function dashboardPendientesAlmacen(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const data = await service.getPendientesAlmacen()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-pendientes-almacen', {
  methods: ['GET'],
  route: 'dashboard/pendientes-almacen',
  authLevel: 'anonymous',
  handler: dashboardPendientesAlmacen,
})
