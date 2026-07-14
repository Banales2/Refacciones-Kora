import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/requerimentosService'

export async function requerimientosCategorias(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const data = await service.getCategorias()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('requerimientos-categorias', {
  methods: ['GET'],
  route: 'requerimientos/categorias',
  authLevel: 'anonymous',
  handler: requerimientosCategorias,
})
