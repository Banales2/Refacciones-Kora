import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { ErroresQuerySchema } from '../schemas/revisionSchema'
import * as service from '../services/revisionService'

/**
 * Cuánto lleva equivocado cada quien al capturar compras.
 *
 * Solo admin. No es un dato de operación: es sobre el desempeño de personas con
 * nombre y apellido, y quien lo mira tiene que ser quien puede hacer algo al
 * respecto.
 *
 * Devuelve dos sumas y no una, porque miden cosas distintas: ver
 * `revisionRepo.erroresPorPersona`.
 */
export async function revisionErrores(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin')

    const params = ErroresQuerySchema.parse({
      desde: request.query.get('desde') ?? undefined,
      hasta: request.query.get('hasta') ?? undefined,
    })

    const data = await service.errores(params.desde, params.hasta)
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('revision-errores', {
  methods: ['GET'],
  route: 'revision/errores',
  authLevel: 'anonymous',
  handler: revisionErrores,
})
