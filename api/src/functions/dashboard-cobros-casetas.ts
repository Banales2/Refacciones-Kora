import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardFacturasService'

// Las mismas ventanas que el análisis de costos, y cerradas por lo mismo: cada
// factura del periodo recalcula sus hallazgos, y un `?dias=` libre podría pedir
// todas las de la historia.
const DIAS_VALIDOS = [30, 90, 180, 365]
const DIAS_DEFAULT = 90

// Lo que PASE pudo cobrar de más en las facturas del periodo.
export async function dashboardCobrosCasetas(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const pedido = Number(req.query.get('dias'))
    const dias = DIAS_VALIDOS.includes(pedido) ? pedido : DIAS_DEFAULT
    const data = await service.getCobrosCasetas(service.ventanaDeDias(dias))
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-cobros-casetas', {
  methods: ['GET'],
  route: 'dashboard/cobros-casetas',
  authLevel: 'anonymous',
  handler: dashboardCobrosCasetas,
})
