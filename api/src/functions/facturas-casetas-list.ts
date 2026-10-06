import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { FacturaCasetasQuerySchema } from '../schemas/facturaCasetasSchema'
import * as service from '../services/facturasCasetasService'

export async function facturasCasetasList(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const params = FacturaCasetasQuerySchema.parse({
      page: req.query.get('page') ?? undefined,
      pageSize: req.query.get('pageSize') ?? undefined,
      search: req.query.get('search') ?? undefined,
      por_revisar: req.query.get('por_revisar') ?? undefined,
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

app.http('facturas-casetas-list', {
  methods: ['GET'],
  route: 'facturas-casetas',
  authLevel: 'anonymous',
  handler: facturasCasetasList,
})
