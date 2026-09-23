import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/tiposPiezaModeloService'

export async function modeloTiposPiezaList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'lector', 'viewer')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const data = await service.getByModelo(id)
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('modelo-tipos-pieza-list', {
  methods: ['GET'],
  route: 'modelos/{id}/tipos-pieza',
  authLevel: 'anonymous',
  handler: modeloTiposPiezaList,
})
