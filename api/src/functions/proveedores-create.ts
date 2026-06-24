import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { ProveedorCreateSchema } from '../schemas/proveedorSchema'
import * as service from '../services/proveedoresService'

export async function proveedoresCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const data = ProveedorCreateSchema.parse(await request.json())
    const created = await service.create(data)
    await audit({
      user, accion: 'CREAR', tabla: 'proveedores',
      registroId: created.id, detalles: { nombre: created.nombre },
      ipAddress: getClientIp(request),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('proveedores-create', {
  methods: ['POST'],
  route: 'proveedores',
  authLevel: 'anonymous',
  handler: proveedoresCreate,
})
