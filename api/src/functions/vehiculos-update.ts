import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { VehiculoUpdateSchema } from '../schemas/vehiculoSchema'
import * as service from '../services/vehiculosService'

export async function vehiculosUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = VehiculoUpdateSchema.parse(await req.json())
    const antes = await capturar('vehiculos', id)
    const updated = await service.update(id, body)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'vehiculos',
      registroId: id,
      antes,
      despues: await capturar('vehiculos', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculos-update', { methods: ['PUT', 'PATCH'], route: 'vehiculos/{id}', authLevel: 'anonymous', handler: vehiculosUpdate })
