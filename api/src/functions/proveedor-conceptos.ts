import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/importarCfdiService'

/**
 * Lo aprendido de los números de parte de un proveedor: qué es cada uno para
 * nosotros. La importación de XML lo usa para no volver a preguntar. Ver la
 * migración 070.
 */
export async function proveedorConceptos(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    return { status: 200, jsonBody: { data: await service.conceptosDe(id) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('proveedor-conceptos', {
  methods: ['GET'],
  route: 'proveedores/{id}/conceptos',
  authLevel: 'anonymous',
  handler: proveedorConceptos,
})
