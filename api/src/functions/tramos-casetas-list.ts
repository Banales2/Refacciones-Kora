import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/facturasCasetasService'

/** Todos los tramos con tarifa, con las casetas que los cobran (puede que ninguna). */
export async function tramosCasetasList(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    return { status: 200, jsonBody: { data: await service.tramos() } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('tramos-casetas-list', {
  methods: ['GET'],
  route: 'tramos-casetas',
  authLevel: 'anonymous',
  handler: tramosCasetasList,
})
