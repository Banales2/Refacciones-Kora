import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/inventarioService'

// Qué hay en cada sucursal, renglón por lote: además de la cantidad trae de qué
// compra salió (proveedor, factura, costo). Sin `sucursal` devuelve toda la
// flota; con `resumen=1` agrupa por refacción en lugar de desglosar el lote.
export async function inventarioExistencias(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector', 'viewer')

    const sucursalRaw = req.query.get('sucursal')
    const sucursalId = sucursalRaw ? parseInt(sucursalRaw, 10) : undefined
    if (sucursalRaw && isNaN(sucursalId!)) {
      return { status: 400, jsonBody: { error: 'Sucursal inválida' } }
    }

    if (req.query.get('resumen') === '1') {
      if (sucursalId === undefined) {
        return { status: 400, jsonBody: { error: 'El resumen requiere una sucursal' } }
      }
      return { status: 200, jsonBody: { data: await service.getResumen(sucursalId) } }
    }

    return { status: 200, jsonBody: { data: await service.getExistencias(sucursalId) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('inventario-existencias', {
  methods: ['GET'],
  route: 'inventario/existencias',
  authLevel: 'anonymous',
  handler: inventarioExistencias,
})
