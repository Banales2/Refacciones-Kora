import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/fugasService'

// Siete cruces que buscan dinero perdido donde no aparece como gasto. Va en una
// sola llamada porque la pantalla los muestra juntos y comparten la pregunta;
// partirlo en siete endpoints serían siete viajes para una pestaña.
export async function dashboardFugas(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const data = await service.getFugas()
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-fugas', {
  methods: ['GET'],
  route: 'dashboard/fugas',
  authLevel: 'anonymous',
  handler: dashboardFugas,
})
