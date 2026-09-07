import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as repo from '../repositories/pendientesRepo'

// Categorías ya capturadas, para el selector de los formularios de incidencia y
// de operación del programa. No hay catálogo: se reaprovecha lo escrito para que
// la misma categoría no acabe guardada de cinco formas.
export async function pendientesCategorias(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const data = await repo.findCategorias()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('pendientes-categorias', {
  methods: ['GET'],
  route: 'pendientes/categorias',
  authLevel: 'anonymous',
  handler: pendientesCategorias,
})
