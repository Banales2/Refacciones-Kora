import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { ValeGasolinaUpdateSchema } from '../schemas/valeGasolinaSchema'
import * as service from '../services/valesGasolinaService'

export async function valesGasolinaUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const data = ValeGasolinaUpdateSchema.parse(await request.json())
    const updated = await service.update(id, data)

    await audit({
      user, accion: 'EDITAR', tabla: 'vales_gasolina',
      registroId: id, ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: updated } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('vales-gasolina-update', {
  methods: ['PUT', 'PATCH'],
  route: 'vales-gasolina/{id}',
  authLevel: 'anonymous',
  handler: valesGasolinaUpdate,
})
