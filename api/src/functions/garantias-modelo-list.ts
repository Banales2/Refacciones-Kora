// Catálogo de garantías de un modelo: qué trae de fábrica cada unidad que se dé
// de alta con él.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/garantiasService'

export async function garantiasModeloList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const modeloId = parseInt(req.params.modeloId, 10)
    if (isNaN(modeloId)) return { status: 400, jsonBody: { error: 'ID de modelo inválido' } }
    const data = await service.getByModelo(modeloId)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('garantias-modelo-list', {
  methods: ['GET'],
  route: 'modelos/{modeloId}/garantias',
  authLevel: 'anonymous',
  handler: garantiasModeloList,
})
