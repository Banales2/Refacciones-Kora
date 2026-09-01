import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/programaService'
import { ProgramaUpdateSchema } from '../schemas/programaSchema'

export async function programaUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = ProgramaUpdateSchema.parse(await req.json())
    const antes = await capturar('programas_mantenimiento', id)
    const updated = await service.update(id, body)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'programas_mantenimiento',
      registroId: id,
      antes,
      despues: await capturar('programas_mantenimiento', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('programa-update', {
  methods: ['PUT', 'PATCH'],
  route: 'programa/{id}',
  authLevel: 'anonymous',
  handler: programaUpdate,
})
