import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/permisosCirculacionService'

export async function permisosCirculacionList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'lector', 'viewer')
    const data = await service.getAll()
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('permisos-circulacion-list', {
  methods: ['GET'],
  route: 'permisos-circulacion',
  authLevel: 'anonymous',
  handler: permisosCirculacionList,
})
