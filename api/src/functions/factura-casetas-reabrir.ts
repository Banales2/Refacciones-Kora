import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/facturasCasetasService'

/** Quita la marca de revisada, para volver a mirarla. Solo admin. */
export async function facturaCasetasReabrir(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    await service.reabrir(id)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'facturas_casetas',
      registroId: id,
      descripcion: 'Reabrió la factura de casetas',
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: { id } } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-casetas-reabrir', {
  methods: ['POST'],
  route: 'facturas-casetas/{id}/reabrir',
  authLevel: 'anonymous',
  handler: facturaCasetasReabrir,
})
