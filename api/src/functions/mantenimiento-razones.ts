import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as repo from '../repositories/mantenimientoRepo'

// Razones ya usadas en la flota, para el selector del formulario. Mismo papel
// que /pendientes/categorias: no hay catálogo, se reaprovecha lo capturado para
// que la misma razón no acabe guardada de cinco formas. PREVENCIÓN va siempre.
export async function mantenimientoRazones(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const data = await repo.findRazones()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('mantenimiento-razones', {
  methods: ['GET'],
  route: 'mantenimientos/razones',
  authLevel: 'anonymous',
  handler: mantenimientoRazones,
})
