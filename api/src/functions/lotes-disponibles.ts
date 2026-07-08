import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/detalleMttoPiezaService'

export async function lotesDisponibles(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor')
    const data = await service.getLotesDisponibles()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('lotes-disponibles', {
  methods: ['GET'],
  route: 'lotes-disponibles',
  authLevel: 'anonymous',
  handler: lotesDisponibles,
})
