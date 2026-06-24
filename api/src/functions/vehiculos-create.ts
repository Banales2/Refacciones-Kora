import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { VehiculoCreateSchema } from '../schemas/vehiculoSchema'
import * as service from '../services/vehiculosService'

export async function vehiculosCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const body = VehiculoCreateSchema.parse(await req.json())
    const created = await service.create(body)
    await audit({ user, accion: 'CREAR', tabla: 'vehiculos', registroId: created.id, ipAddress: getClientIp(req) })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculos-create', { methods: ['POST'], route: 'vehiculos', authLevel: 'anonymous', handler: vehiculosCreate })
