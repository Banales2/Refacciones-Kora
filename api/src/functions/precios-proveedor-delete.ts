import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/preciosProveedorService'

export async function preciosProveedorDelete(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const antes = await capturar('precios_proveedor', id)
    await service.remove(id)

    await audit({
      user,
      accion: 'ELIMINAR',
      tabla: 'precios_proveedor',
      registroId: id,
      antes,
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('precios-proveedor-delete', {
  methods: ['DELETE'],
  route: 'precios-proveedor/{id}',
  authLevel: 'anonymous',
  handler: preciosProveedorDelete,
})
