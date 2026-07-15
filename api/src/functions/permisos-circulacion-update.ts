import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { PermisoCirculacionUpdateSchema } from '../schemas/permisoCirculacionSchema'
import * as service from '../services/permisosCirculacionService'

export async function permisosCirculacionUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const data = PermisoCirculacionUpdateSchema.parse(await request.json())
    const updated = await service.update(id, data)

    await audit({
      user, accion: 'EDITAR', tabla: 'permisos_circulacion',
      registroId: id, ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: updated } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('permisos-circulacion-update', {
  methods: ['PUT', 'PATCH'],
  route: 'permisos-circulacion/{id}',
  authLevel: 'anonymous',
  handler: permisosCirculacionUpdate,
})
