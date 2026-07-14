import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { RecargaUpdateSchema } from '../schemas/recargaSchema'
import * as service from '../services/recargasService'

export async function recargaUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const data = RecargaUpdateSchema.parse(await request.json())
    const updated = await service.update(id, data)

    await audit({
      user, accion: 'EDITAR', tabla: 'recargas_combustible',
      registroId: id, ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: updated } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('recarga-update', {
  methods: ['PUT', 'PATCH'],
  route: 'recargas/{id}',
  authLevel: 'anonymous',
  handler: recargaUpdate,
})
