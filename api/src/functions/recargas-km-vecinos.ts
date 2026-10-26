import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, exigirVehiculo } from '../shared/alcance'
import * as service from '../services/recargasService'

// Las lecturas que acotan a una recarga de cierta fecha, para que el formulario
// avise en rojo mientras se captura. Quien de verdad lo impide es el alta (ver
// `validarKmPorFecha`); esto solo adelanta el aviso.
export async function recargasKmVecinos(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor', 'practicante', 'responsable')
    const vehiculoId = parseInt(request.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const fecha = request.query.get('fecha') ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { status: 400, jsonBody: { error: 'Fecha inválida' } }
    const excluir = request.query.get('excluir')
    const excluirId = excluir ? parseInt(excluir, 10) : undefined
    if (excluirId !== undefined && isNaN(excluirId)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    await exigirVehiculo(vehiculoId, await alcanceDe(user))

    const data = await service.kmVecinos(vehiculoId, fecha, excluirId)
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('recargas-km-vecinos', {
  methods: ['GET'],
  route: 'vehiculos/{vehiculoId}/recargas/km-vecinos',
  authLevel: 'anonymous',
  handler: recargasKmVecinos,
})
