import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/inventarioService'

// Nombres ya usados al autorizar un traspaso, para el selector del formulario.
// Mismo papel que /incidencias/reportadores: no hay catálogo de jefes de
// almacén, así que se reaprovecha lo capturado para que la misma persona no
// acabe escrita de cinco formas.
export async function inventarioTraspasoAutorizadores(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const data = await service.getAutorizadores()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('inventario-traspaso-autorizadores', {
  methods: ['GET'],
  // Antes que `inventario/traspasos` en la carga de rutas no cambia nada: son
  // rutas distintas, no una con un parámetro que pudiera tragarse la otra.
  route: 'inventario/traspasos/autorizadores',
  authLevel: 'anonymous',
  handler: inventarioTraspasoAutorizadores,
})
