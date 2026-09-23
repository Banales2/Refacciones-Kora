import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { FacturaGasolinaQuerySchema } from '../schemas/facturaGasolinaSchema'
import * as service from '../services/facturasGasolinaService'

export async function facturasGasolinaList(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector', 'practicante')
    const params = FacturaGasolinaQuerySchema.parse({
      page: req.query.get('page') ?? undefined,
      pageSize: req.query.get('pageSize') ?? undefined,
      gasolinera_id: req.query.get('gasolinera_id') ?? undefined,
      search: req.query.get('search') ?? undefined,
      desde: req.query.get('desde') ?? undefined,
      hasta: req.query.get('hasta') ?? undefined,
      por_conciliar: req.query.get('por_conciliar') ?? undefined,
    })
    const r = await service.getAll(params)
    return {
      status: 200,
      jsonBody: {
        data: r.data,
        pagination: { page: r.page, pageSize: r.pageSize, total: r.total },
      },
    }
  } catch (err) { return handleError(err, ctx) }
}

app.http('facturas-gasolina-list', {
  methods: ['GET'],
  route: 'facturas-gasolina',
  authLevel: 'anonymous',
  handler: facturasGasolinaList,
})
