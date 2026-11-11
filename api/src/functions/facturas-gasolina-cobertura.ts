import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { CoberturaQuerySchema } from '../schemas/facturaGasolinaSchema'
import * as service from '../services/facturasGasolinaService'

/**
 * Qué días de una gasolinera están facturados: sus facturas en orden, con lo
 * que cubre cada una según sus recargas casadas, y entre ellas los huecos de
 * cargas que ninguna factura cobra.
 *
 * La factura solo trae su fecha de emisión; si se pierde una entera, aquí sale
 * como varios días sin cobrar entre dos que sí.
 */
export async function facturasGasolinaCobertura(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const q = CoberturaQuerySchema.parse({
      gasolinera_id: req.query.get('gasolinera_id') ?? undefined,
      desde: req.query.get('desde') ?? undefined,
      hasta: req.query.get('hasta') ?? undefined,
    })
    const data = await service.cobertura(q.gasolinera_id, q.desde, q.hasta)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('facturas-gasolina-cobertura', {
  methods: ['GET'],
  route: 'facturas-gasolina/cobertura',
  authLevel: 'anonymous',
  handler: facturasGasolinaCobertura,
})
