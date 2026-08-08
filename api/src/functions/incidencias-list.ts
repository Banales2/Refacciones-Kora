import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/incidenciasService'

// Incidencias de toda la flota, para la pantalla de Incidencias.
export async function incidenciasList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const data = await service.getAll()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('incidencias-list', {
  methods: ['GET'],
  route: 'incidencias',
  authLevel: 'anonymous',
  handler: incidenciasList,
})
