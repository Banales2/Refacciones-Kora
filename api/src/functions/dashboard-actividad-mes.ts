import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError, ValidationError } from '../shared/errors'
import * as service from '../services/actividadDiaService'

export async function dashboardActividadMes(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const mes = req.query.get('mes')
    if (!mes) throw new ValidationError('Falta el parámetro mes (YYYY-MM)')
    const data = await service.getActividadDelMes(mes)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-actividad-mes', {
  methods: ['GET'],
  route: 'dashboard/actividad-mes',
  authLevel: 'anonymous',
  handler: dashboardActividadMes,
})
