import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { TecnicoCreateSchema } from '../schemas/tecnicoSchema'
import * as service from '../services/tecnicosService'

export async function tecnicosCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const data = TecnicoCreateSchema.parse(await request.json())
    const created = await service.create(data)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'tecnicos',
      registroId: created.id,
      despues: await capturar('tecnicos', created.id),
      detalles: { nombre: created.nombre },
      ipAddress: getClientIp(request),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('tecnicos-create', {
  methods: ['POST'],
  route: 'tecnicos',
  authLevel: 'anonymous',
  handler: tecnicosCreate,
})
