import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/facturasCasetasService'

/** Los tags de PASE, con su unidad y cuánto han cruzado. Los sin unidad, primero. */
export async function tagsCasetasList(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    return { status: 200, jsonBody: { data: await service.tags() } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('tags-casetas-list', {
  methods: ['GET'],
  route: 'tags-casetas',
  authLevel: 'anonymous',
  handler: tagsCasetasList,
})
