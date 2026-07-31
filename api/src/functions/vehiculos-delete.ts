import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/vehiculosService'

export async function vehiculosDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const antes = await capturar('vehiculos', id)
    await service.remove(id)
    await audit({
      user,
      accion: 'ELIMINAR',
      tabla: 'vehiculos',
      registroId: id,
      antes,
      ipAddress: getClientIp(req),
    })
    return { status: 204 }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculos-delete', { methods: ['DELETE'], route: 'vehiculos/{id}', authLevel: 'anonymous', handler: vehiculosDelete })
