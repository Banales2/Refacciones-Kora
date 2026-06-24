import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/proveedoresService'

export async function proveedoresList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'lector')
    const data = await service.getAll()
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('proveedores-list', {
  methods: ['GET'],
  route: 'proveedores',
  authLevel: 'anonymous',
  handler: proveedoresList,
})
