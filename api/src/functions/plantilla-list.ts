import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/plantillaService'

export async function plantillaList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const modeloId = parseInt(req.params.modeloId, 10)
    if (isNaN(modeloId)) return { status: 400, jsonBody: { error: 'ID de modelo inválido' } }
    const data = await service.getByModelo(modeloId)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('plantilla-list', {
  methods: ['GET'],
  route: 'modelos/{modeloId}/plantilla',
  authLevel: 'anonymous',
  handler: plantillaList,
})
