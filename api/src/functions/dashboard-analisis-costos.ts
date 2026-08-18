import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/costosService'

// Ventanas permitidas. Es una lista cerrada y no un número libre porque el
// análisis recorre todas las recargas y mantenimientos del rango: dejar pasar
// `?dias=100000` sería barrer la base entera desde una URL.
const DIAS_VALIDOS = [30, 90, 180, 365]
const DIAS_DEFAULT = 90

export async function dashboardAnalisisCostos(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'lector')
    const pedido = Number(req.query.get('dias'))
    const dias = DIAS_VALIDOS.includes(pedido) ? pedido : DIAS_DEFAULT
    const data = await service.getAnalisisCostos(dias)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-analisis-costos', {
  methods: ['GET'],
  route: 'dashboard/analisis-costos',
  authLevel: 'anonymous',
  handler: dashboardAnalisisCostos,
})
