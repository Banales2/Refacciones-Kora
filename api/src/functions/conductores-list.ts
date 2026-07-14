import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/conductoresService'

export async function conductoresList(
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

app.http('conductores-list', {
  methods: ['GET'],
  route: 'conductores',
  authLevel: 'anonymous',
  handler: conductoresList,
})
