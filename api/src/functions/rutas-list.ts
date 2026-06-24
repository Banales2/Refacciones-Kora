import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/rutasService'

export async function rutasList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    return { status: 200, jsonBody: { data: await service.getAll() } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('rutas-list', { methods: ['GET'], route: 'rutas', authLevel: 'anonymous', handler: rutasList })
