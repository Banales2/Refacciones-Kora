import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import { PrecioProveedorCreateSchema } from '../schemas/precioProveedorSchema'
import * as service from '../services/preciosProveedorService'

export async function preciosProveedorCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const proveedorId = parseInt(request.params.id, 10)
    if (isNaN(proveedorId)) return { status: 400, jsonBody: { error: 'ID de proveedor inválido' } }

    const data = PrecioProveedorCreateSchema.parse(await request.json())
    // Quién capturó el precio sale de la sesión: es a quién preguntarle de
    // dónde salió el número.
    const created = await service.create(proveedorId, data, await nombreOCorreo(user))

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'precios_proveedor',
      registroId: created.id,
      despues: await capturar('precios_proveedor', created.id),
      detalles: { proveedor_id: proveedorId, pieza: created.pieza, precio: created.precio },
      ipAddress: getClientIp(request),
    })

    return { status: 201, jsonBody: { data: created } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('precios-proveedor-create', {
  methods: ['POST'],
  route: 'proveedores/{id}/precios',
  authLevel: 'anonymous',
  handler: preciosProveedorCreate,
})
