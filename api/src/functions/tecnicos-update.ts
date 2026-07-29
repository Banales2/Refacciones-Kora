import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { TecnicoUpdateSchema } from '../schemas/tecnicoSchema'
import * as service from '../services/tecnicosService'

export async function tecnicosUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const data = TecnicoUpdateSchema.parse(await request.json())
    const updated = await service.update(id, data)

    await audit({
      user, accion: 'EDITAR', tabla: 'tecnicos',
      registroId: id, ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: updated } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('tecnicos-update', {
  methods: ['PUT', 'PATCH'],
  route: 'tecnicos/{id}',
  authLevel: 'anonymous',
  handler: tecnicosUpdate,
})
