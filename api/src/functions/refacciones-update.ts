import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { RefaccionUpdateSchema } from '../schemas/refaccionSchema'
import * as service from '../services/refaccionesService'

export async function refaccionesUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const input = RefaccionUpdateSchema.parse(await request.json())
    const data = await service.update(id, input)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'piezas',
      registroId: id,
      ipAddress: getClientIp(request),
    })
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('refacciones-update', {
  methods: ['PUT', 'PATCH'],
  route: 'refacciones/{id}',
  authLevel: 'anonymous',
  handler: refaccionesUpdate,
})
