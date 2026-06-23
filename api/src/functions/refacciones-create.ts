import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { RefaccionCreateSchema } from '../schemas/refaccionSchema'
import * as service from '../services/refaccionesService'

export async function refaccionesCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')

    const body = RefaccionCreateSchema.parse(await request.json())
    const created = await service.create(body)

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'piezas',
      registroId: created.id,
      detalles: { numero_serie: created.numero_serie },
      ipAddress: getClientIp(request),
    })

    return { status: 201, jsonBody: { data: created } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('refacciones-create', {
  methods: ['POST'],
  route: 'refacciones',
  authLevel: 'anonymous',
  handler: refaccionesCreate,
})
