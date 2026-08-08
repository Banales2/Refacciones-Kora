import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/incidenciasService'

// Nombres ya usados en "reportado por", para el selector del formulario. Mismo
// papel que /requerimientos/categorias: no hay catálogo, se reaprovecha lo
// capturado para que la misma persona no acabe escrita de cinco formas.
export async function incidenciasReportadores(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const data = await service.getReportadores()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('incidencias-reportadores', {
  methods: ['GET'],
  route: 'incidencias/reportadores',
  authLevel: 'anonymous',
  handler: incidenciasReportadores,
})
