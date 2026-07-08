import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/vehiculosService'

export async function vehiculosGet(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const vehiculo = await service.getById(id)
    return { status: 200, jsonBody: { data: vehiculo } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculos-get', { methods: ['GET'], route: 'vehiculos/{id}', authLevel: 'anonymous', handler: vehiculosGet })
