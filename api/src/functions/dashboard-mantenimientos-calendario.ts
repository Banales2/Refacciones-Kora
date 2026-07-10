import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardService'

export async function dashboardMantenimientosCalendario(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const data = await service.getMantenimientosCalendario()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-mantenimientos-calendario', {
  methods: ['GET'],
  route: 'dashboard/mantenimientos-calendario',
  authLevel: 'anonymous',
  handler: dashboardMantenimientosCalendario,
})
