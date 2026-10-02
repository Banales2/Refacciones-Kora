import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole, exigirCapturaPropia } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { RecargaUpdateSchema } from '../schemas/recargaSchema'
import * as service from '../services/recargasService'

export async function recargaUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    // El practicante también, pero solo las recargas que él capturó: es para
    // arreglar su propio error de captura sin esperar a un editor.
    const user = requireRole(request, 'admin', 'editor', 'practicante')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    exigirCapturaPropia(user, (await service.getById(id)).capturado_por)

    const data = RecargaUpdateSchema.parse(await request.json())

    // Lo que ya está conciliado en una factura lo protege el servicio.
    const antes = await capturar('recargas_combustible', id)
    const updated = await service.update(id, data, user.userRoles.includes('admin'))

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'recargas_combustible',
      registroId: id,
      antes,
      despues: await capturar('recargas_combustible', id),
      ipAddress: getClientIp(request),
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
