import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as repo from '../repositories/unidadesPiezaRepo'

// Las piezas físicas de una refacción, una por una. Solo tienen unidades las de
// un tipo con rastreo individual (migración 025); para el resto la lista viene
// vacía y la pantalla lo dice.
export async function piezaUnidadesList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    requireRole(request, 'admin', 'editor', 'lector')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    return { status: 200, jsonBody: { data: await repo.findByPieza(id) } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('pieza-unidades-list', {
  methods: ['GET'],
  route: 'piezas/{id}/unidades',
  authLevel: 'anonymous',
  handler: piezaUnidadesList,
})
