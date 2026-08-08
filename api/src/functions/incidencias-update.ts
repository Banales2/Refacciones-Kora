import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/incidenciasService'
import { IncidenciaUpdateSchema } from '../schemas/incidenciaSchema'

export async function incidenciasUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = IncidenciaUpdateSchema.parse(await req.json())
    const antes = await capturar('incidencias', id)
    const updated = await service.update(id, body)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'incidencias',
      registroId: id,
      antes,
      despues: await capturar('incidencias', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('incidencias-update', {
  methods: ['PUT'],
  route: 'incidencias/{id}',
  authLevel: 'anonymous',
  handler: incidenciasUpdate,
})
