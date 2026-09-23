import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/chequeosService'
import { alcanceDe } from '../shared/alcance'

// Quiénes han declarado alguna vez, para ofrecerlos en el formulario. Mismo
// criterio que `incidencias/reportadores`: no hay catálogo de empleados, y sin
// la lista la misma persona termina escrita de cinco formas.
export async function chequeosDeclarantes(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'lector', 'responsable')
    const data = await service.getDeclarantes(await alcanceDe(user))
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('chequeos-declarantes', {
  methods: ['GET'],
  route: 'chequeos/declarantes',
  authLevel: 'anonymous',
  handler: chequeosDeclarantes,
})
