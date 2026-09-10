import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as repo from '../repositories/unidadesPiezaRepo'

/**
 * El stock que está en el estante sin identidad, porque se compró antes de que
 * se encendiera el rastreo de su tipo.
 *
 * Se filtra por tipo —al activar el interruptor, para preguntar por todo lo que
 * ese tipo ya tenía— o por refacción, para la ficha de una sola.
 */
export async function unidadesSinIdentificar(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'lector')
    const tipo  = request.query.get('tipo_pieza_id')
    const pieza = request.query.get('pieza_id')
    const tipoPiezaId = tipo  ? parseInt(tipo, 10)  : undefined
    const piezaId     = pieza ? parseInt(pieza, 10) : undefined
    if ((tipo && isNaN(tipoPiezaId!)) || (pieza && isNaN(piezaId!))) {
      return { status: 400, jsonBody: { error: 'Filtro inválido' } }
    }
    return {
      status: 200,
      jsonBody: { data: await repo.findSinIdentificar({ tipoPiezaId, piezaId }) },
    }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('unidades-sin-identificar', {
  methods: ['GET'],
  route: 'unidades/sin-identificar',
  authLevel: 'anonymous',
  handler: unidadesSinIdentificar,
})
