import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { TipoPiezaUpdateSchema } from '../schemas/tipoPiezaSchema'
import * as service from '../services/tiposPiezaService'

export async function tiposPiezaUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const data = TipoPiezaUpdateSchema.parse(await request.json())
    const antes = await capturar('tipos_pieza', id)
    const updated = await service.update(id, data)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'tipos_pieza',
      registroId: id,
      antes,
      despues: await capturar('tipos_pieza', id),
      detalles: { nombre: updated.nombre },
      ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: updated } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('tipos-pieza-update', {
  methods: ['PUT'],
  route: 'tipos-pieza/{id}',
  authLevel: 'anonymous',
  handler: tiposPiezaUpdate,
})
