import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { GasolineraUpdateSchema } from '../schemas/gasolineraSchema'
import * as service from '../services/gasolinerasService'

export async function gasolinerasUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const data = GasolineraUpdateSchema.parse(await request.json())
    const updated = await service.update(id, data)

    await audit({
      user, accion: 'EDITAR', tabla: 'gasolineras',
      registroId: id, ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: updated } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('gasolineras-update', {
  methods: ['PUT', 'PATCH'],
  route: 'gasolineras/{id}',
  authLevel: 'anonymous',
  handler: gasolinerasUpdate,
})
