import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/facturasCasetasService'

/**
 * Todo lo que un tag ha pagado en una caseta (`?caseta=155`), factura por
 * factura, con lo que pagaron los demás tags ahí: la evidencia para enseñarle
 * a PASE un aumento o un cobro raro.
 */
export async function tagsCasetasHistorial(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const tag = (req.params.tag ?? '').trim()
    const caseta = (req.query.get('caseta') ?? '').trim()
    if (!tag || tag.length > 30) return { status: 400, jsonBody: { error: 'Tag inválido' } }
    if (!caseta || caseta.length > 10) return { status: 400, jsonBody: { error: 'Caseta inválida' } }
    return { status: 200, jsonBody: { data: await service.historialEnCaseta(tag, caseta) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('tags-casetas-historial', {
  methods: ['GET'],
  route: 'tags-casetas/{tag}/historial',
  authLevel: 'anonymous',
  handler: tagsCasetasHistorial,
})
