import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, exigirVehiculo } from '../shared/alcance'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { RecargaEmergenciaSchema } from '../schemas/recargaSchema'
import * as service from '../services/recargasService'

// La carga que el chofer hizo de su bolsa porque no le alcanzaba para ir por
// el vale. Solo el admin: es gasto sin vale que lo respalde, y alguien con
// autoridad tiene que responder por él. Ver la migración 056.
export async function recargaEmergenciaCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin')
    const vehiculoId = parseInt(request.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    await exigirVehiculo(vehiculoId, await alcanceDe(user))

    const data = RecargaEmergenciaSchema.parse(await request.json())
    const created = await service.createEmergencia(vehiculoId, data)

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'recargas_combustible',
      registroId: created.id,
      despues: await capturar('recargas_combustible', created.id),
      detalles: { vehiculo_id: vehiculoId, litros: created.litros, costo: created.costo, emergencia: true },
      ipAddress: getClientIp(request),
    })

    return { status: 201, jsonBody: { data: created } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('recarga-emergencia-create', {
  methods: ['POST'],
  route: 'vehiculos/{vehiculoId}/recargas/emergencia',
  authLevel: 'anonymous',
  handler: recargaEmergenciaCreate,
})
