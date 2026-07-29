import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/valesGasolinaService'

export async function valesGasolinaList(
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

app.http('vales-gasolina-list', {
  methods: ['GET'],
  route: 'vales-gasolina',
  authLevel: 'anonymous',
  handler: valesGasolinaList,
})
