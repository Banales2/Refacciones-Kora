import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/facturasCasetasService'

/**
 * Los cruces de una caseta cobrados con una clase y un importe
 * (`?clase=9&total=236`), con su factura: para rastrear un "fuera de tarifa"
 * de la pestaña Tarifas y verificarlo contra la página del operador.
 */
export async function tarifasCasetasCruces(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const caseta = (req.params.caseta ?? '').trim()
    const clase = Number(req.query.get('clase'))
    const total = Number(req.query.get('total'))
    if (!caseta || caseta.length > 10) return { status: 400, jsonBody: { error: 'Caseta inválida' } }
    if (!Number.isInteger(clase) || clase < 0 || clase > 20) {
      return { status: 400, jsonBody: { error: 'Clase inválida' } }
    }
    if (!Number.isFinite(total) || total <= 0) return { status: 400, jsonBody: { error: 'Importe inválido' } }
    return { status: 200, jsonBody: { data: await service.crucesDeImporte(caseta, clase, total) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('tarifas-casetas-cruces', {
  methods: ['GET'],
  route: 'tarifas-casetas/{caseta}/cruces',
  authLevel: 'anonymous',
  handler: tarifasCasetasCruces,
})
