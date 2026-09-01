// Atender un renglón por su cuenta: su "o cada N meses" venció antes de que
// llegara el kilometraje de su columna. No cuenta como visita —no se hizo la
// columna—, solo pone ese renglón al día.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/programaVehiculoService'
import { AtenderOperacionSchema } from '../schemas/programaVehiculoSchema'

export async function vehiculoProgramaAtender(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const vehiculoId  = parseInt(req.params.vehiculoId, 10)
    const operacionId = parseInt(req.params.operacionId, 10)
    if (isNaN(vehiculoId) || isNaN(operacionId)) {
      return { status: 400, jsonBody: { error: 'ID inválido' } }
    }
    const body = AtenderOperacionSchema.parse(await req.json())
    const estado = await service.atenderOperacion(vehiculoId, operacionId, body)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'vehiculo_operacion_estado',
      registroId: operacionId,
      despues: { vehiculo_id: vehiculoId, operacion_id: operacionId, ...body },
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: estado } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculo-programa-atender', {
  methods: ['POST'],
  route: 'vehiculos/{vehiculoId}/programa/operaciones/{operacionId}/atender',
  authLevel: 'anonymous',
  handler: vehiculoProgramaAtender,
})
