import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe } from '../shared/alcance'
import * as service from '../services/recargasService'

// Las recargas de todos los vehículos, para la pestaña Recargas de Vales de
// gasolina. Mismos roles que el listado por vehículo; el responsable sólo
// recibe las de los vehículos de su sucursal (y los de translado).
export async function recargasListAll(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor', 'lector', 'responsable')
    const data = await service.getAll(await alcanceDe(user))
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('recargas-list-all', {
  methods: ['GET'],
  route: 'recargas',
  authLevel: 'anonymous',
  handler: recargasListAll,
})
