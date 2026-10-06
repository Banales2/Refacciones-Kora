import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/facturasCasetasService'

/** La factura con sus cruces, sus hallazgos y lo que cruzó cada unidad. */
export async function facturaCasetasGet(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    return { status: 200, jsonBody: { data: await service.detalle(id) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-casetas-get', {
  methods: ['GET'],
  route: 'facturas-casetas/{id}',
  authLevel: 'anonymous',
  handler: facturaCasetasGet,
})
