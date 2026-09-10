import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/descuadresService'

// Los descuadres de inventario que siguen abiertos. Sin `sucursal_id` devuelve
// los de toda la flota, que es lo que necesita el aviso de la pantalla de
// inventario: un descuadre en una sucursal que nadie abre no se puede quedar
// invisible.
export async function descuadresList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'lector')
    const raw = request.query.get('sucursal_id')
    const sucursalId = raw ? parseInt(raw, 10) : undefined
    if (raw && isNaN(sucursalId!)) {
      return { status: 400, jsonBody: { error: 'sucursal_id inválido' } }
    }
    return { status: 200, jsonBody: { data: await service.getAbiertos(sucursalId) } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('descuadres-list', {
  methods: ['GET'],
  route: 'descuadres',
  authLevel: 'anonymous',
  handler: descuadresList,
})
