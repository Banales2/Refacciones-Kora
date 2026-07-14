import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { RecargaCreateSchema } from '../schemas/recargaSchema'
import * as service from '../services/recargasService'

export async function recargaCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const vehiculoId = parseInt(request.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }

    const data = RecargaCreateSchema.parse(await request.json())
    const created = await service.create(vehiculoId, data)

    await audit({
      user, accion: 'CREAR', tabla: 'recargas_combustible',
      registroId: created.id, detalles: { vehiculo_id: vehiculoId, litros: created.litros, costo: created.costo },
      ipAddress: getClientIp(request),
    })

    return { status: 201, jsonBody: { data: created } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('recarga-create', {
  methods: ['POST'],
  route: 'vehiculos/{vehiculoId}/recargas',
  authLevel: 'anonymous',
  handler: recargaCreate,
})
