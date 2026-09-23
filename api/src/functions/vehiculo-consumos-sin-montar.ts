import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/piezasVehiculoService'

// Piezas de una refacción que ya se descontaron del almacén en un mantenimiento
// de esta unidad y que todavía no se han montado en ella.
//
// Existe para que el montaje pueda ligarse a un consumo en vez de descontar
// otra vez: sin esta lista, quien monta la pieza no tiene forma de saber que el
// almacén ya la dio de baja, y la unidad terminaría contada en dos lados.
export async function vehiculoConsumosSinMontar(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'lector', 'viewer')
    const id      = parseInt(request.params.id, 10)
    const piezaId = parseInt(request.query.get('pieza_id') ?? '', 10)
    if (isNaN(id))      return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    if (isNaN(piezaId)) return { status: 400, jsonBody: { error: 'pieza_id requerido' } }

    return { status: 200, jsonBody: { data: await service.getConsumosSinMontar(id, piezaId) } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('vehiculo-consumos-sin-montar', {
  methods: ['GET'],
  route: 'vehiculos/{id}/consumos-sin-montar',
  authLevel: 'anonymous',
  handler: vehiculoConsumosSinMontar,
})
