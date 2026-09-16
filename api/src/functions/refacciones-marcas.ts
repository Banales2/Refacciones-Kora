import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/refaccionesService'

// Marcas ya capturadas, para el selector del formulario de refacción. Mismo
// papel que /incidencias/reportadores: no hay catálogo de marcas, así que se
// reaprovecha lo capturado para que Bosch no acabe escrita de cinco formas.
export async function refaccionesMarcas(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const data = await service.getMarcas()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('refacciones-marcas', {
  methods: ['GET'],
  route: 'refacciones/marcas',
  authLevel: 'anonymous',
  handler: refaccionesMarcas,
})
