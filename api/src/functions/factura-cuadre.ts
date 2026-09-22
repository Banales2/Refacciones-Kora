import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/cuadreFacturaService'

/**
 * El cuadre de una factura: lo que dice el papel contra lo capturado.
 *
 * Devuelve las dos listas y las diferencias ya calculadas — qué falta capturar,
 * qué sobra, y qué está capturado con otros valores. Ver
 * `docs/revision-de-facturas.md`.
 */
export async function facturaCuadre(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'responsable')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    return { status: 200, jsonBody: { data: await service.getCuadre(id) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-cuadre', {
  methods: ['GET'],
  route: 'facturas/{id}/cuadre',
  authLevel: 'anonymous',
  handler: facturaCuadre,
})
