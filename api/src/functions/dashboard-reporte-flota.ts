import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardService'

export async function dashboardReporteFlota(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const periodo = req.query.get('periodo') === 'semana' ? 'semana' : 'mes'
    const data = await service.getReporteFlota(periodo)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-reporte-flota', {
  methods: ['GET'],
  route: 'dashboard/reporte-flota',
  authLevel: 'anonymous',
  handler: dashboardReporteFlota,
})
