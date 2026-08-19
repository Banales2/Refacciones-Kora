import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/dashboardService'
import { parseRango } from '../shared/rangoReporte'

export async function dashboardDocumentosPorVencer(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    // Con rango la pregunta cambia de "qué vence pronto" a "qué vence entre
    // estas fechas": es como se arma el calendario de trámites de un año.
    const data = await service.getDocumentosPorVencer(parseRango(req.query))
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-documentos-por-vencer', {
  methods: ['GET'],
  route: 'dashboard/documentos-por-vencer',
  authLevel: 'anonymous',
  handler: dashboardDocumentosPorVencer,
})
