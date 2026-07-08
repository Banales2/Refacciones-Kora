import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardService'

export async function dashboardRequerimientosPendientes(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const data = await service.getRequerimientosVencidos()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-requerimientos-pendientes', {
  methods: ['GET'],
  route: 'dashboard/requerimientos-pendientes',
  authLevel: 'anonymous',
  handler: dashboardRequerimientosPendientes,
})
