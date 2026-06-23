import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit } from '../shared/audit'
import { RefaccionQuerySchema } from '../schemas/refaccionSchema'
import * as service from '../services/refaccionesService'

export async function refaccionesList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor', 'lector')

    const params = RefaccionQuerySchema.parse({
      page: request.query.get('page'),
      pageSize: request.query.get('pageSize'),
      search: request.query.get('search') ?? undefined,
    })

    const result = await service.getAll(params)

    await audit({ user, accion: 'VER_SENSIBLE', tabla: 'piezas' })

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

app.http('refacciones-list', {
  methods: ['GET'],
  route: 'refacciones',
  authLevel: 'anonymous',
  handler: refaccionesList,
})
