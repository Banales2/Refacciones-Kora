import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError, ValidationError } from '../shared/errors'
import * as service from '../services/actividadDiaService'

export async function dashboardActividadDia(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const fecha = req.query.get('fecha')
    if (!fecha) throw new ValidationError('Falta el parámetro fecha (YYYY-MM-DD)')
    const data = await service.getActividadDelDia(fecha)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-actividad-dia', {
  methods: ['GET'],
  route: 'dashboard/actividad-dia',
  authLevel: 'anonymous',
  handler: dashboardActividadDia,
})
