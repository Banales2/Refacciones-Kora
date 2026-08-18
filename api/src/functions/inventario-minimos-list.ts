import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/inventarioService'

// Mínimos configurados, cada uno con la existencia actual de esa refacción en
// esa sucursal para poder compararlos. Con `faltantes=1` devuelve solo los que
// están por debajo, que es la lista que hay que salir a surtir.
export async function inventarioMinimosList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector', 'viewer')

    const sucursalRaw = req.query.get('sucursal')
    const sucursalId = sucursalRaw ? parseInt(sucursalRaw, 10) : undefined
    if (sucursalRaw && isNaN(sucursalId!)) {
      return { status: 400, jsonBody: { error: 'Sucursal inválida' } }
    }

    const data = req.query.get('faltantes') === '1'
      ? await service.getFaltantes(sucursalId)
      : await service.getMinimos(sucursalId)

    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('inventario-minimos-list', {
  methods: ['GET'],
  route: 'inventario/minimos',
  authLevel: 'anonymous',
  handler: inventarioMinimosList,
})
