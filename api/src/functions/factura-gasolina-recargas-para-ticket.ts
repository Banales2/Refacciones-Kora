import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/registroDesdeFacturaService'

/**
 * Las recargas de la gasolinera de la factura que todavía admiten otro ticket:
 * de dónde se elige la recarga a la que le faltó el ticket de un tanque. Ver
 * `facturasGasolinaRepo.recargasParaTicket` y la migración 077.
 */
export async function facturaGasolinaRecargasParaTicket(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    return { status: 200, jsonBody: { data: await service.recargasParaTicket(id) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-gasolina-recargas-para-ticket', {
  methods: ['GET'],
  route: 'facturas-gasolina/{id}/recargas-para-ticket',
  authLevel: 'anonymous',
  handler: facturaGasolinaRecargasParaTicket,
})
