import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { ProveedorUpdateSchema } from '../schemas/proveedorSchema'
import * as service from '../services/proveedoresService'

export async function proveedoresUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const data = ProveedorUpdateSchema.parse(await request.json())
    const updated = await service.update(id, data)
    await audit({
      user, accion: 'EDITAR', tabla: 'proveedores',
      registroId: id, ipAddress: getClientIp(request),
    })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('proveedores-update', {
  methods: ['PUT', 'PATCH'],
  route: 'proveedores/{id}',
  authLevel: 'anonymous',
  handler: proveedoresUpdate,
})
