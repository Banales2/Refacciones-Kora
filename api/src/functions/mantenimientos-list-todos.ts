// Historial de mantenimientos de toda la flota. El listado por vehículo
// (mantenimiento-list) sigue existiendo: éste es para rastrearlos sin saber de
// antemano a qué unidad pertenecen.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/mantenimientoService'

export async function mantenimientosListTodos(
  req: HttpRequest, ctx: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const data = await service.getAll()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('mantenimientos-list-todos', {
  methods: ['GET'],
  route: 'mantenimientos',
  authLevel: 'anonymous',
  handler: mantenimientosListTodos,
})
