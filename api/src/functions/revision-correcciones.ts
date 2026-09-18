import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { CorreccionesQuerySchema } from '../schemas/revisionSchema'
import * as service from '../services/revisionService'

/**
 * El detalle detrás del acumulado de errores de captura.
 *
 * Solo admin, igual que `/revision/errores`: es el mismo dato, más desglosado.
 * Sin esto el reporte dice "esta persona lleva 4,300 pesos mal capturados" y no
 * hay forma de ir a ver cuáles — un número que no se puede auditar no sirve para
 * hablar con nadie.
 */
export async function revisionCorrecciones(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin')

    const params = CorreccionesQuerySchema.parse({
      desde: request.query.get('desde') ?? undefined,
      hasta: request.query.get('hasta') ?? undefined,
      capturado_por: request.query.get('capturado_por') ?? undefined,
    })

    const data = await service.detalleCorrecciones(
      params.desde, params.hasta, params.capturado_por,
    )
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('revision-correcciones', {
  methods: ['GET'],
  route: 'revision/correcciones',
  authLevel: 'anonymous',
  handler: revisionCorrecciones,
})
