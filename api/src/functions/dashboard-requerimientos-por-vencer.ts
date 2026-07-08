import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardService'

export async function dashboardRequerimientosPorVencer(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const data = await service.getRequerimientosPorVencer()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-requerimientos-por-vencer', {
  methods: ['GET'],
  route: 'dashboard/requerimientos-por-vencer',
  authLevel: 'anonymous',
  handler: dashboardRequerimientosPorVencer,
})
