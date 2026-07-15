import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { PermisoCirculacionCreateSchema } from '../schemas/permisoCirculacionSchema'
import * as service from '../services/permisosCirculacionService'

export async function permisosCirculacionCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const data = PermisoCirculacionCreateSchema.parse(await request.json())
    const created = await service.create(data)
    await audit({
      user, accion: 'CREAR', tabla: 'permisos_circulacion',
      registroId: created.id, detalles: { zona_circulacion: created.zona_circulacion },
      ipAddress: getClientIp(request),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('permisos-circulacion-create', {
  methods: ['POST'],
  route: 'permisos-circulacion',
  authLevel: 'anonymous',
  handler: permisosCirculacionCreate,
})
