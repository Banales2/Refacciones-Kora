// El orden de los renglones es el del manual, y se conserva porque es como el
// taller lee la tabla. Se manda la lista completa de ids en el orden deseado;
// los que no vengan se van al final conservando su orden relativo.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/programaService'
import { ReordenarSchema } from '../schemas/programaSchema'

export async function programaOperacionesReordenar(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const programaId = parseInt(req.params.programaId, 10)
    if (isNaN(programaId)) return { status: 400, jsonBody: { error: 'ID de programa inválido' } }
    const { ids } = ReordenarSchema.parse(await req.json())
    const programa = await service.reordenarOperaciones(programaId, ids)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'programas_mantenimiento',
      registroId: programaId,
      despues: await capturar('programas_mantenimiento', programaId),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: programa } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('programa-operaciones-reordenar', {
  methods: ['PUT'],
  route: 'programa/{programaId}/operaciones/orden',
  authLevel: 'anonymous',
  handler: programaOperacionesReordenar,
})
