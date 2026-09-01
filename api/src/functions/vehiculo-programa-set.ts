import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/programaVehiculoService'
import { AsignarProgramaSchema } from '../schemas/programaVehiculoSchema'

export async function vehiculoProgramaSet(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const body = AsignarProgramaSchema.parse(await req.json())
    const vinculo = await service.asignar(vehiculoId, body)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'vehiculo_programa',
      registroId: vehiculoId,
      despues: { ...vinculo },
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: await service.getEstado(vehiculoId) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculo-programa-set', {
  methods: ['PUT', 'PATCH'],
  route: 'vehiculos/{vehiculoId}/programa',
  authLevel: 'anonymous',
  handler: vehiculoProgramaSet,
})
