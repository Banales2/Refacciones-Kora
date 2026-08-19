// Comparativa de precios de todas las refacciones contra todos los proveedores.
// El listado por proveedor (precios-proveedor-list) muestra lo que cotiza uno;
// éste es la tabla completa, que es lo que se lleva a la junta de compras.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/preciosProveedorService'

export async function preciosProveedorComparativa(
  req: HttpRequest, ctx: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector', 'viewer')
    const data = await service.getComparativa()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('precios-proveedor-comparativa', {
  methods: ['GET'],
  // Va antes que /precios-proveedor/{id} en la tabla de rutas de Functions, que
  // resuelve el literal primero: "comparativa" nunca se lee como un id.
  route: 'precios-proveedor/comparativa',
  authLevel: 'anonymous',
  handler: preciosProveedorComparativa,
})
