import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardService'

export async function dashboardDocumentosPorVencer(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const data = await service.getDocumentosPorVencer()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-documentos-por-vencer', {
  methods: ['GET'],
  route: 'dashboard/documentos-por-vencer',
  authLevel: 'anonymous',
  handler: dashboardDocumentosPorVencer,
})
