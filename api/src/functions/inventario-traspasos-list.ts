import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/inventarioService'

// Historial de traspasos. Filtrado por sucursal trae las dos puntas: lo que esa
// sucursal recibió y lo que entregó.
export async function inventarioTraspasosList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector', 'viewer')

    const sucursalRaw = req.query.get('sucursal')
    const sucursalId = sucursalRaw ? parseInt(sucursalRaw, 10) : undefined
    if (sucursalRaw && isNaN(sucursalId!)) {
      return { status: 400, jsonBody: { error: 'Sucursal inválida' } }
    }

    return { status: 200, jsonBody: { data: await service.getTraspasos(sucursalId) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('inventario-traspasos-list', {
  methods: ['GET'],
  route: 'inventario/traspasos',
  authLevel: 'anonymous',
  handler: inventarioTraspasosList,
})
