// Todo lo que se ha gastado en una gasolinera: sus recargas, con el folio del
// vale que autorizó cada una. El vale no guarda costo ni gasolinera —eso vive
// en la recarga—, así que el gasto sale de ahí y no de los vales.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as repo from '../repositories/recargasRepo'

export async function gasolinerasConsumos(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    return { status: 200, jsonBody: { data: await repo.findConsumosDeGasolinera(id) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('gasolineras-consumos', {
  methods: ['GET'],
  route: 'gasolineras/{id}/consumos',
  authLevel: 'anonymous',
  handler: gasolinerasConsumos,
})
