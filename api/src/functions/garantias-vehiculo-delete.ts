// Solo se elimina la garantía capturada a mano en la unidad. La heredada del
// modelo se cancela (con fecha y motivo), no se borra: el servicio contesta con
// esa explicación.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/garantiasService'

export async function garantiasVehiculoDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'responsable')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const antes = await capturar('garantias_vehiculo', id)
    await service.removeVehiculo(id)
    await audit({
      user,
      accion: 'ELIMINAR',
      tabla: 'garantias_vehiculo',
      registroId: id,
      antes,
      ipAddress: getClientIp(req),
    })
    return { status: 204 }
  } catch (err) { return handleError(err, ctx) }
}

app.http('garantias-vehiculo-delete', {
  // POST y no DELETE: la API no expone el verbo DELETE en ninguna ruta, para
  // poder bloquearlo entero en el borde. Ver docs/sin-delete.md.
  methods: ['POST'],
  route: 'garantias/{id}/quitar',
  authLevel: 'anonymous',
  handler: garantiasVehiculoDelete,
})
