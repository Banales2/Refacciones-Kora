import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as repo from '../repositories/vehiculosRepo'

// Categorías de carrocería ya usadas en la flota (torton, rabon, camioneta…),
// para el selector del formulario. Mismo papel que /pendientes/categorias: no
// hay catálogo, se reaprovecha lo capturado para que la misma categoría no
// acabe guardada de cinco formas.
export async function vehiculosCategorias(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const data = await repo.findCategorias()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculos-categorias', {
  methods: ['GET'],
  route: 'vehiculos/categorias',
  authLevel: 'anonymous',
  handler: vehiculosCategorias,
})
