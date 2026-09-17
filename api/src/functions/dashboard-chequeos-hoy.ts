import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/chequeosService'

// Las dos cifras del día: cuántas unidades llevan chequeo y qué reportes del
// chofer siguen sin leer. Van juntas porque son la misma pregunta desde dos
// lados —si el chequeo se está haciendo, y si está sirviendo de algo— y porque
// las dos tienen que estar en cero al cerrar.
export async function dashboardChequeosHoy(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const data = await service.getResumenHoy()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-chequeos-hoy', {
  methods: ['GET'],
  route: 'dashboard/chequeos-hoy',
  authLevel: 'anonymous',
  handler: dashboardChequeosHoy,
})
