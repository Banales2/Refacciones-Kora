import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/programaService'
import { OperacionUpdateSchema } from '../schemas/programaSchema'

export async function programaOperacionUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = OperacionUpdateSchema.parse(await req.json())
    const antes = await capturar('programa_operaciones', id)
    const updated = await service.updateOperacion(id, body)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'programa_operaciones',
      registroId: id,
      antes,
      despues: await capturar('programa_operaciones', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('programa-operacion-update', {
  methods: ['PUT', 'PATCH'],
  route: 'programa-operaciones/{id}',
  authLevel: 'anonymous',
  handler: programaOperacionUpdate,
})
