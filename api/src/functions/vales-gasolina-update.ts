import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole, exigirCapturaPropia } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe } from '../shared/alcance'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { ValeGasolinaUpdateSchema } from '../schemas/valeGasolinaSchema'
import * as service from '../services/valesGasolinaService'

export async function valesGasolinaUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    // El practicante también, pero solo los vales que él capturó: es para
    // arreglar su propio error de captura sin esperar a un editor.
    const user = requireRole(request, 'admin', 'editor', 'practicante')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    exigirCapturaPropia(user, (await service.getById(id)).capturado_por)

    const data = ValeGasolinaUpdateSchema.parse(await request.json())
    const antes = await capturar('vales_gasolina', id)
    const updated = await service.update(id, data, (await alcanceDe(user)).sucursalId)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'vales_gasolina',
      registroId: id,
      antes,
      despues: await capturar('vales_gasolina', id),
      ipAddress: getClientIp(request),
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
