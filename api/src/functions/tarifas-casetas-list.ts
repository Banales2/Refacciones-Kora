import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/facturasCasetasService'

/**
 * Las casetas con sus tramos y tarifas de hoy, y lo cobrado en cada una. Las
 * tarifas se cargan por migración (ver la 071); aquí solo se consultan.
 */
export async function tarifasCasetasList(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    return { status: 200, jsonBody: { data: await service.tarifasPorCaseta() } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('tarifas-casetas-list', {
  methods: ['GET'],
  route: 'tarifas-casetas',
  authLevel: 'anonymous',
  handler: tarifasCasetasList,
})
