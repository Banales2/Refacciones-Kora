import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardService'

export async function dashboardRequerimientosHistorial(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const mesesParam = req.query.get('meses')
    const meses = mesesParam ? parseInt(mesesParam, 10) : 12
    const data = await service.getHistorial(isNaN(meses) ? 12 : meses)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-requerimientos-historial', {
  methods: ['GET'],
  route: 'dashboard/requerimientos-historial',
  authLevel: 'anonymous',
  handler: dashboardRequerimientosHistorial,
})
