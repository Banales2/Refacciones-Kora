import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { FacturaQuerySchema } from '../schemas/facturaSchema'
import * as service from '../services/facturasService'

export async function facturasList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'viewer')

    const params = FacturaQuerySchema.parse({
      page: request.query.get('page') ?? undefined,
      pageSize: request.query.get('pageSize') ?? undefined,
      search: request.query.get('search') ?? undefined,
      desde: request.query.get('desde') ?? undefined,
      hasta: request.query.get('hasta') ?? undefined,
    })

    const result = await service.getAll(params)

    return {
      status: 200,
      jsonBody: {
        data: result.data,
        pagination: { page: result.page, pageSize: result.pageSize, total: result.total },
      },
    }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('facturas-list', {
  methods: ['GET'],
  route: 'facturas',
  authLevel: 'anonymous',
  handler: facturasList,
})
