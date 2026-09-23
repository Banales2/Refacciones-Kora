import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/preciosProveedorService'

export async function preciosProveedorList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'lector', 'viewer')
    const proveedorId = parseInt(request.params.id, 10)
    if (isNaN(proveedorId)) return { status: 400, jsonBody: { error: 'ID de proveedor inválido' } }

    const data = await service.getByProveedor(proveedorId)
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('precios-proveedor-list', {
  methods: ['GET'],
  route: 'proveedores/{id}/precios',
  authLevel: 'anonymous',
  handler: preciosProveedorList,
})
