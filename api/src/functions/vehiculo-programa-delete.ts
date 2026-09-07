import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/programaVehiculoService'
import { EtapaSchema } from '../schemas/programaVehiculoSchema'

export async function vehiculoProgramaDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    // Se quita una etapa a la vez. Sin decir cuál se quita la del fabricante,
    // que es la que existía cuando este endpoint era de un solo programa.
    const etapa = EtapaSchema.default('fabricante').parse(
      req.query.get('etapa') ?? undefined
    )
    await service.quitar(vehiculoId, etapa)
    await audit({
      user,
      accion: 'ELIMINAR',
      tabla: 'vehiculo_programa',
      registroId: vehiculoId,
      antes: { etapa },
      ipAddress: getClientIp(req),
    })
    return { status: 204 }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculo-programa-delete', {
  methods: ['DELETE'],
  route: 'vehiculos/{vehiculoId}/programa',
  authLevel: 'anonymous',
  handler: vehiculoProgramaDelete,
})
