import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { SinFacturarQuerySchema } from '../schemas/facturaGasolinaSchema'
import * as service from '../services/facturasGasolinaService'

/**
 * Las recargas que ninguna factura ha reclamado todavía.
 *
 * Es el reverso de lo que enseña la conciliación: allá se ve lo que la
 * gasolinera cobra y no está capturado; aquí, lo que está capturado y la
 * gasolinera no ha cobrado.
 *
 * Casi nunca es un problema —la factura llega después de la carga— pero una
 * recarga de hace tres meses sin facturar sí lo es, y de ahí que cada renglón
 * traiga los días que lleva esperando.
 */
export async function recargasSinFacturar(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'responsable')

    const params = SinFacturarQuerySchema.parse({
      page: req.query.get('page') ?? undefined,
      pageSize: req.query.get('pageSize') ?? undefined,
      gasolinera_id: req.query.get('gasolinera_id') ?? undefined,
      search: req.query.get('search') ?? undefined,
      desde: req.query.get('desde') ?? undefined,
      hasta: req.query.get('hasta') ?? undefined,
    })

    const r = await service.sinFacturar(params)
    return {
      status: 200,
      jsonBody: {
        data: r.data,
        costo_total: r.costo_total,
        pagination: { page: r.page, pageSize: r.pageSize, total: r.total },
      },
    }
  } catch (err) { return handleError(err, ctx) }
}

app.http('recargas-sin-facturar', {
  methods: ['GET'],
  route: 'facturas-gasolina/sin-facturar',
  authLevel: 'anonymous',
  handler: recargasSinFacturar,
})
