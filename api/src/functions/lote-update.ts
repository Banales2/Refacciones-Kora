import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { LoteUpdateSchema } from '../schemas/loteSchema'
import * as service from '../services/lotesService'

export async function loteUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const body = LoteUpdateSchema.parse(await request.json())
    const updated = await service.updateLote(id, body)

    await audit({
      user, accion: 'EDITAR', tabla: 'lotes_pieza',
      registroId: id, ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: updated } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('lote-update', {
  methods: ['PUT', 'PATCH'],
  route: 'lotes/{id}',
  authLevel: 'anonymous',
  handler: loteUpdate,
})
