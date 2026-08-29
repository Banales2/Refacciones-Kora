// Comparativa de proveedores de una sola refacción: precio vigente de cada uno
// y en cuántos días entrega. Es lo que se imprime al abrir la pieza, cuando la
// pregunta no es "dónde hay margen en el catálogo" sino "a quién le compro
// ésta". La comparativa completa vive en precios-proveedor-comparativa.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/preciosProveedorService'

export async function preciosProveedorPieza(
  req: HttpRequest, ctx: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector', 'viewer')
    const piezaId = parseInt(req.params.id, 10)
    if (isNaN(piezaId)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const data = await service.getComparativaPieza(piezaId)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('precios-proveedor-pieza', {
  methods: ['GET'],
  route: 'piezas/{id}/comparativa-precios',
  authLevel: 'anonymous',
  handler: preciosProveedorPieza,
})
