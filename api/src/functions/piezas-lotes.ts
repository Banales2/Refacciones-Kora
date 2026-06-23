import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit } from '../shared/audit'
import * as service from '../services/refaccionesService'

export async function piezasLotes(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor', 'lector')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const data = await service.getLotesByPiezaId(id)
    await audit({ user, accion: 'VER_SENSIBLE', tabla: 'lotes_pieza', registroId: id })
    return { status: 200, jsonBody: data }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('piezas-lotes', {
  methods: ['GET'],
  route: 'piezas/{id}/lotes',
  authLevel: 'anonymous',
  handler: piezasLotes,
})
