import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/agendaMantenimientoService'

export async function agendaMantenimientoDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const antes = await capturar('agendas_mantenimiento', id)
    await service.remove(id)
    await audit({
      user,
      accion: 'ELIMINAR',
      tabla: 'agendas_mantenimiento',
      registroId: id,
      antes,
      ipAddress: getClientIp(req),
    })
    return { status: 204 }
  } catch (err) { return handleError(err, ctx) }
}

app.http('agenda-mantenimiento-delete', {
  methods: ['DELETE'],
  route: 'agendas-mantenimiento/{id}',
  authLevel: 'anonymous',
  handler: agendaMantenimientoDelete,
})
