// Los programas de un modelo, completos: cabecera, fases y operaciones con sus
// celdas. Devuelve un arreglo de 0 a 2 —el del fabricante primero—; vacío
// cuando el modelo todavía no tiene ninguno, que no es un 404: la pantalla del
// modelo siempre existe y ofrece crearlos.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/programaService'

export async function programaGet(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const modeloId = parseInt(req.params.modeloId, 10)
    if (isNaN(modeloId)) return { status: 400, jsonBody: { error: 'ID de modelo inválido' } }
    return { status: 200, jsonBody: { data: await service.getByModelo(modeloId) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('programa-get', {
  methods: ['GET'],
  route: 'modelos/{modeloId}/programa',
  authLevel: 'anonymous',
  handler: programaGet,
})
