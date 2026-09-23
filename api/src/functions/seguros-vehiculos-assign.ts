import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { SeguroAssignSchema } from '../schemas/seguroSchema'
import * as service from '../services/segurosService'

export async function segurosVehiculosAssign(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const { vehiculo_ids } = SeguroAssignSchema.parse(await request.json())
    await service.assignVehiculos(id, vehiculo_ids)

    await audit({
      user, accion: 'EDITAR', tabla: 'seguros',
      registroId: id, detalles: { asignar_vehiculos: vehiculo_ids },
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('seguros-vehiculos-assign', {
  methods: ['POST'],
  route: 'seguros/{id}/vehiculos',
  authLevel: 'anonymous',
  handler: segurosVehiculosAssign,
})
