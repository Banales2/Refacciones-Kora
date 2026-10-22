import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardFacturasService'

// Lo que encontró la conciliación de gasolina: cargas cobradas que nadie
// capturó, capturadas que nadie cobra, quién no reporta y qué se capturó en la
// gasolinera equivocada.
export async function dashboardConciliacionGasolina(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const data = await service.getConciliacionGasolina()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-conciliacion-gasolina', {
  methods: ['GET'],
  route: 'dashboard/conciliacion-gasolina',
  authLevel: 'anonymous',
  handler: dashboardConciliacionGasolina,
})
