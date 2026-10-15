import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { SinReportarQuerySchema } from '../schemas/registroDesdeFacturaSchema'
import * as service from '../services/registroDesdeFacturaService'

/**
 * Las omisiones que destapó la factura: recargas que el chofer no reportó y,
 * entre ellas, las que además no tenían el vale registrado por el encargado.
 * Es la lista que se lleva a cada uno. Ver la migración 069.
 */
export async function facturasGasolinaSinReportar(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const p = SinReportarQuerySchema.parse({
      desde: req.query.get('desde') ?? undefined,
      hasta: req.query.get('hasta') ?? undefined,
    })
    return { status: 200, jsonBody: { data: await service.sinReportar(p) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('facturas-gasolina-sin-reportar', {
  methods: ['GET'],
  route: 'facturas-gasolina/sin-reportar',
  authLevel: 'anonymous',
  handler: facturasGasolinaSinReportar,
})
