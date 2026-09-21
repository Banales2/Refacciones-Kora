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
      // Las dos banderas del listado: la bandeja del verificador y la vista de
      // facturas de taller. El schema las acepta desde siempre, pero hasta ahora
      // no se leían del query y la bandeja devolvía la lista completa.
      por_revisar: request.query.get('por_revisar') ?? undefined,
      con_mano_obra: request.query.get('con_mano_obra') ?? undefined,
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
