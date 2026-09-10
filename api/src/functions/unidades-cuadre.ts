import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as repo from '../repositories/unidadesPiezaRepo'

/**
 * Dónde no cuadran las piezas identificadas con las existencias.
 *
 * Mientras las dos capas convivan —`existencias_lote` cuenta, `unidades_pieza`
 * identifica— pueden separarse si algún movimiento toca una y no la otra. Esto
 * lo hace visible en vez de dejarlo silencioso, y es el requisito para que algún
 * día la existencia SEA el conteo de unidades.
 *
 * Devuelve solo lo que discrepa, y solo de tipos rastreados: en los de granel no
 * hay unidades que cuadrar.
 */
export async function unidadesCuadre(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'lector')
    return { status: 200, jsonBody: { data: await repo.contarPorSucursal() } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('unidades-cuadre', {
  methods: ['GET'],
  route: 'unidades/cuadre',
  authLevel: 'anonymous',
  handler: unidadesCuadre,
})
