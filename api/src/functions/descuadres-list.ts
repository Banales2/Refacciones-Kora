import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, sucursalPermitida } from '../shared/alcance'
import * as service from '../services/descuadresService'
import { sinDatosDeCompra } from '../shared/datosDeCompra'

// Los descuadres de inventario que siguen abiertos. Sin `sucursal_id` devuelve
// los de toda la flota, que es lo que necesita el aviso de la pantalla de
// inventario: un descuadre en una sucursal que nadie abre no se puede quedar
// invisible.
export async function descuadresList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor', 'lector', 'responsable')
    const raw = request.query.get('sucursal_id')
    const pedida = raw ? parseInt(raw, 10) : undefined
    if (raw && isNaN(pedida!)) {
      return { status: 400, jsonBody: { error: 'sucursal_id inválido' } }
    }
    const sucursalId = sucursalPermitida(pedida, await alcanceDe(user))
    return { status: 200, jsonBody: { data: sinDatosDeCompra(await service.getAbiertos(sucursalId), user) } }
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
