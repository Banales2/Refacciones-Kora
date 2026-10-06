import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { nombreOCorreo } from '../shared/usuario'
import { RevisarCasetasSchema } from '../schemas/facturaCasetasSchema'
import * as service from '../services/facturasCasetasService'

/**
 * Marca la factura como revisada. Solo admin, igual que conciliar la de
 * gasolina: es el segundo par de ojos sobre lo que PASE cobró.
 */
export async function facturaCasetasRevisar(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = RevisarCasetasSchema.parse(await req.json())
    await service.revisar(id, await nombreOCorreo(user), body.nota ?? null)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'facturas_casetas',
      registroId: id,
      descripcion: 'Revisó la factura de casetas',
      detalles: { nota: body.nota ?? null },
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: { id } } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-casetas-revisar', {
  methods: ['POST'],
  route: 'facturas-casetas/{id}/revisar',
  authLevel: 'anonymous',
  handler: facturaCasetasRevisar,
})
