import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardService'
import { parseRango } from '../shared/rangoReporte'

export async function dashboardResumenMes(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    // Sin ?anio ni ?desde/?hasta sigue siendo la ventana móvil de 30 días con
    // la que se pinta el tablero; con ellos, el periodo que se pidió para el
    // reporte.
    const data = await service.getResumenMes(parseRango(req.query))
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-resumen-mes', {
  methods: ['GET'],
  route: 'dashboard/resumen-mes',
  authLevel: 'anonymous',
  handler: dashboardResumenMes,
})
