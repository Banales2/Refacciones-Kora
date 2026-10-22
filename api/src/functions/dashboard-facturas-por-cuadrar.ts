import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardFacturasService'

// Las facturas que esperan su segundo par de ojos —gasolina, casetas,
// refacciones y taller— y los pendientes de captura que salen de ellas.
export async function dashboardFacturasPorCuadrar(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const data = await service.getFacturasPorCuadrar()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-facturas-por-cuadrar', {
  methods: ['GET'],
  route: 'dashboard/facturas-por-cuadrar',
  authLevel: 'anonymous',
  handler: dashboardFacturasPorCuadrar,
})
