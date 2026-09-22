import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/tiposPiezaService'

export async function tiposPiezaList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'lector', 'viewer', 'practicante')
    // ?archivados=1 los incluye. Solo lo pide la pantalla del catálogo, para poder
    // verlos y restaurarlos; los selectores del alta usan la lista normal.
    const data = await service.getAll(request.query.get('archivados') === '1')
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('tipos-pieza-list', {
  methods: ['GET'],
  route: 'tipos-pieza',
  authLevel: 'anonymous',
  handler: tiposPiezaList,
})
