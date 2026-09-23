import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardService'

export async function dashboardIncidenciasAbiertas(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const data = await service.getIncidenciasAbiertas()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-incidencias-abiertas', {
  methods: ['GET'],
  route: 'dashboard/incidencias-abiertas',
  authLevel: 'anonymous',
  handler: dashboardIncidenciasAbiertas,
})
