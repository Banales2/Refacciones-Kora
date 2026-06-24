import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { VehiculoQuerySchema } from '../schemas/vehiculoSchema'
import * as service from '../services/vehiculosService'

export async function vehiculosList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'lector')

    const params = VehiculoQuerySchema.parse({
      page:      request.query.get('page')      ?? undefined,
      pageSize:  request.query.get('pageSize')  ?? undefined,
      search:    request.query.get('search')    ?? undefined,
      tipo:      request.query.get('tipo')      ?? undefined,
      modelo_id: request.query.get('modelo_id') ?? undefined,
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

app.http('vehiculos-list', {
  methods: ['GET'],
  route: 'vehiculos',
  authLevel: 'anonymous',
  handler: vehiculosList,
})
