// Corregir la garantía de una unidad: su arranque, su folio o su cancelación.
// Los intervalos heredados del modelo también se pueden ajustar aquí cuando esa
// unidad en particular se vendió con otra cobertura.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/garantiasService'
import { GarantiaVehiculoUpdateSchema } from '../schemas/garantiaSchema'

export async function garantiasVehiculoUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = GarantiaVehiculoUpdateSchema.parse(await req.json())
    const antes = await capturar('garantias_vehiculo', id)
    const updated = await service.updateVehiculo(id, body)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'garantias_vehiculo',
      registroId: id,
      antes,
      despues: await capturar('garantias_vehiculo', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('garantias-vehiculo-update', {
  methods: ['PUT', 'PATCH'],
  route: 'garantias/{id}',
  authLevel: 'anonymous',
  handler: garantiasVehiculoUpdate,
})
