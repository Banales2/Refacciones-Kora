import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardService'

export async function dashboardPreventivosPorVencer(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector', 'responsable')
    const data = await service.getPreventivosPorVencer()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-preventivos-por-vencer', {
  methods: ['GET'],
  route: 'dashboard/preventivos-por-vencer',
  authLevel: 'anonymous',
  handler: dashboardPreventivosPorVencer,
})
