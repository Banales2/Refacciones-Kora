import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardService'

export async function dashboardResumenMes(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const data = await service.getResumenMes()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-resumen-mes', {
  methods: ['GET'],
  route: 'dashboard/resumen-mes',
  authLevel: 'anonymous',
  handler: dashboardResumenMes,
})
