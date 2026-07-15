import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { PermisoCirculacionAssignSchema } from '../schemas/permisoCirculacionSchema'
import * as service from '../services/permisosCirculacionService'

export async function permisosCirculacionVehiculosAssign(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const { vehiculo_ids } = PermisoCirculacionAssignSchema.parse(await request.json())
    await service.assignVehiculos(id, vehiculo_ids)

    await audit({
      user, accion: 'EDITAR', tabla: 'permisos_circulacion',
      registroId: id, detalles: { asignar_vehiculos: vehiculo_ids },
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('permisos-circulacion-vehiculos-assign', {
  methods: ['POST'],
  route: 'permisos-circulacion/{id}/vehiculos',
  authLevel: 'anonymous',
  handler: permisosCirculacionVehiculosAssign,
})
