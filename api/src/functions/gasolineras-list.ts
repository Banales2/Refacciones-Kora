import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/gasolinerasService'
import { exigirSucursalAsignada } from '../shared/alcance'

export async function gasolinerasList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor', 'lector', 'viewer', 'practicante', 'responsable')
    await exigirSucursalAsignada(user)
    // ?archivados=1 los incluye. Solo lo pide la pantalla del catálogo, para poder
    // verlos y restaurarlos; los selectores del alta usan la lista normal.
    const data = await service.getAll(request.query.get('archivados') === '1')
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('gasolineras-list', {
  methods: ['GET'],
  route: 'gasolineras',
  authLevel: 'anonymous',
  handler: gasolinerasList,
})
