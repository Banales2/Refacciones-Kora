import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/revisionService'

/**
 * Lo que la revisión tuvo que corregirle a esta factura.
 *
 * Se lee con permiso de editor y no solo de admin: quien capturó la compra tiene
 * que poder ver en qué se equivocó, que es el único punto de registrarlo. Lo que
 * queda reservado al admin es el acumulado por persona (`/revision/errores`).
 */
export async function facturaCorrecciones(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'responsable')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID de factura inválido' } }

    const data = await service.correcciones(id)
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('factura-correcciones', {
  methods: ['GET'],
  route: 'facturas/{id}/correcciones',
  authLevel: 'anonymous',
  handler: facturaCorrecciones,
})
