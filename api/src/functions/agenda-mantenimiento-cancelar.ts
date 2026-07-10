import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/agendaMantenimientoService'

export async function agendaMantenimientoCancelar(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const updated = await service.cancelar(id)
    await audit({ user, accion: 'EDITAR', tabla: 'agendas_mantenimiento', registroId: id, ipAddress: getClientIp(req) })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('agenda-mantenimiento-cancelar', {
  methods: ['POST'],
  route: 'agendas-mantenimiento/{id}/cancelar',
  authLevel: 'anonymous',
  handler: agendaMantenimientoCancelar,
})
