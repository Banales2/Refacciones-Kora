import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { SinFacturarQuerySchema } from '../schemas/manoObraSchema'
import * as service from '../services/manoObraService'

/**
 * Los mantenimientos que ninguna factura ha reclamado todavía.
 *
 * Es el reverso de lo que enseña el cuadre: allá se ve lo que el taller cobra y
 * no está capturado; aquí, lo que está capturado y el taller no ha cobrado.
 *
 * Existe porque en mantenimientos sí se puede. Un servicio se registra cuando el
 * camión vuelve del taller, exista o no el papel —igual que una recarga—, así
 * que la ausencia de factura se detecta sola. En refacciones no hay equivalente:
 * un lote no existe hasta que alguien captura la compra, y por eso allá hizo
 * falta un botón para registrar la factura que nadie había visto.
 *
 * Casi nunca es un problema —el papel llega después del servicio— pero uno de
 * hace tres meses sin facturar sí lo es, y de ahí que cada renglón traiga los
 * días que lleva esperando.
 */
export async function mantenimientosSinFacturar(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'responsable')

    const params = SinFacturarQuerySchema.parse({
      page: req.query.get('page') ?? undefined,
      pageSize: req.query.get('pageSize') ?? undefined,
      tecnico_id: req.query.get('tecnico_id') ?? undefined,
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

app.http('mantenimientos-sin-facturar', {
  methods: ['GET'],
  route: 'mantenimientos/sin-facturar',
  authLevel: 'anonymous',
  handler: mantenimientosSinFacturar,
})
