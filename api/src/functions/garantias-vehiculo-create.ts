// Garantía capturada directamente en una unidad: una extensión comprada aparte
// o la de una unidad cuyo modelo todavía no tiene catálogo. Las del modelo se
// copian solas al dar de alta el vehículo.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/garantiasService'
import { GarantiaVehiculoCreateSchema } from '../schemas/garantiaSchema'

export async function garantiasVehiculoCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const body = GarantiaVehiculoCreateSchema.parse(await req.json())
    const created = await service.createVehiculo(vehiculoId, body)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'garantias_vehiculo',
      registroId: created.id,
      despues: await capturar('garantias_vehiculo', created.id),
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('garantias-vehiculo-create', {
  methods: ['POST'],
  route: 'vehiculos/{vehiculoId}/garantias',
  authLevel: 'anonymous',
  handler: garantiasVehiculoCreate,
})
