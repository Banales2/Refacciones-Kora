import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { DetalleMttoPiezaCreateSchema } from '../schemas/detalleMttoPiezaSchema'
import * as service from '../services/detalleMttoPiezaService'

export async function detalleMttoCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const mantenimientoId = parseInt(req.params.id, 10)
    if (isNaN(mantenimientoId)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = DetalleMttoPiezaCreateSchema.parse(await req.json())
    const created = await service.create(mantenimientoId, body)
    await audit({ user, accion: 'CREAR', tabla: 'detalle_mtto_pieza', registroId: created.id, ipAddress: getClientIp(req) })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('detalle-mtto-create', {
  methods: ['POST'],
  route: 'mantenimientos/{id}/detalle',
  authLevel: 'anonymous',
  handler: detalleMttoCreate,
})
