import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/detalleMttoPiezaService'

export async function mantenimientoDetalleList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const data = await service.getDetalle(id)
    return { status: 200, jsonBody: data }
  } catch (err) { return handleError(err, ctx) }
}

app.http('mantenimiento-detalle-list', {
  methods: ['GET'],
  route: 'mantenimientos/{id}/detalle',
  authLevel: 'anonymous',
  handler: mantenimientoDetalleList,
})
