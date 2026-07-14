import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { GasolineraCreateSchema } from '../schemas/gasolineraSchema'
import * as service from '../services/gasolinerasService'

export async function gasolinerasCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const data = GasolineraCreateSchema.parse(await request.json())
    const created = await service.create(data)
    await audit({
      user, accion: 'CREAR', tabla: 'gasolineras',
      registroId: created.id, detalles: { nombre: created.nombre },
      ipAddress: getClientIp(request),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('gasolineras-create', {
  methods: ['POST'],
  route: 'gasolineras',
  authLevel: 'anonymous',
  handler: gasolinerasCreate,
})
