import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/piezasVehiculoService'

// Todo lo que el vehículo ha traído montado, no solo lo vigente: de qué compra
// salió cada pieza, cuánto duró y por qué se quitó.
export async function vehiculoPiezasHistorial(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'lector', 'viewer')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const data = await service.getHistorial(id)
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('vehiculo-piezas-historial', {
  methods: ['GET'],
  // Antes de `{tipoId}` en el archivo, pero las rutas no compiten: `historial`
  // solo responde a GET y el set/remove por tipo son PUT y DELETE.
  route: 'vehiculos/{id}/piezas/historial',
  authLevel: 'anonymous',
  handler: vehiculoPiezasHistorial,
})
