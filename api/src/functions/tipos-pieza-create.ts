import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { TipoPiezaCreateSchema } from '../schemas/tipoPiezaSchema'
import * as service from '../services/tiposPiezaService'

export async function tiposPiezaCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const data = TipoPiezaCreateSchema.parse(await request.json())
    const created = await service.create(data)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'tipos_pieza',
      registroId: created.id,
      despues: await capturar('tipos_pieza', created.id),
      detalles: { nombre: created.nombre },
      ipAddress: getClientIp(request),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('tipos-pieza-create', {
  methods: ['POST'],
  route: 'tipos-pieza',
  authLevel: 'anonymous',
  handler: tiposPiezaCreate,
})
