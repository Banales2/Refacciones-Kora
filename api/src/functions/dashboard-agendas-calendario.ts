import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/agendaMantenimientoService'

export async function dashboardAgendasCalendario(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const data = await service.getAllConVehiculo()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-agendas-calendario', {
  methods: ['GET'],
  route: 'dashboard/agendas-calendario',
  authLevel: 'anonymous',
  handler: dashboardAgendasCalendario,
})
