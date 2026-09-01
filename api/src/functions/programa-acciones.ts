// La leyenda de la tabla del fabricante: I, A, R, T, L. Es un catálogo global y
// pequeño, así que la cuadrícula lo pide una vez y lo cachea.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/programaService'

export async function programaAcciones(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    return { status: 200, jsonBody: { data: await service.getAcciones() } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('programa-acciones', {
  methods: ['GET'],
  // Ruta literal aparte de `programa/{id}` para que no compitan por el mismo
  // segmento: "acciones" no es el id de ningún programa.
  route: 'programa-acciones',
  authLevel: 'anonymous',
  handler: programaAcciones,
})
