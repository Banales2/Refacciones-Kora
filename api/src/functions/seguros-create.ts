import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { SeguroCreateSchema } from '../schemas/seguroSchema'
import * as service from '../services/segurosService'

export async function segurosCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const data = SeguroCreateSchema.parse(await request.json())
    const created = await service.create(data)
    await audit({
      user, accion: 'CREAR', tabla: 'seguros',
      registroId: created.id, detalles: { poliza: created.poliza },
      ipAddress: getClientIp(request),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('seguros-create', {
  methods: ['POST'],
  route: 'seguros',
  authLevel: 'anonymous',
  handler: segurosCreate,
})
