import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { ConductorCreateSchema } from '../schemas/conductorSchema'
import * as service from '../services/conductoresService'

export async function conductoresCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const data = ConductorCreateSchema.parse(await request.json())
    const created = await service.create(data)
    await audit({
      user, accion: 'CREAR', tabla: 'conductores',
      registroId: created.id, detalles: { nombre: created.nombre },
      ipAddress: getClientIp(request),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('conductores-create', {
  methods: ['POST'],
  route: 'conductores',
  authLevel: 'anonymous',
  handler: conductoresCreate,
})
