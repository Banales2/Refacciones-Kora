import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { PrecioProveedorUpdateSchema } from '../schemas/precioProveedorSchema'
import * as service from '../services/preciosProveedorService'

export async function preciosProveedorUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const data = PrecioProveedorUpdateSchema.parse(await request.json())
    const antes = await capturar('precios_proveedor', id)
    const updated = await service.update(id, data)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'precios_proveedor',
      registroId: id,
      antes,
      despues: await capturar('precios_proveedor', id),
      ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: updated } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('precios-proveedor-update', {
  methods: ['PUT', 'PATCH'],
  route: 'precios-proveedor/{id}',
  authLevel: 'anonymous',
  handler: preciosProveedorUpdate,
})
