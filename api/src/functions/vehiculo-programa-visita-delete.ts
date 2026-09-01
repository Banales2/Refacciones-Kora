import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/programaVehiculoService'

export async function vehiculoProgramaVisitaDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const estado = await service.deshacerVisita(id)
    await audit({
      user,
      accion: 'ELIMINAR',
      tabla: 'vehiculo_programa_visita',
      registroId: id,
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: estado } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculo-programa-visita-delete', {
  methods: ['DELETE'],
  route: 'programa-visitas/{id}',
  authLevel: 'anonymous',
  handler: vehiculoProgramaVisitaDelete,
})
