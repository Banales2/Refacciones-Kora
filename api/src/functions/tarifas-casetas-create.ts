import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { TarifaCreateSchema } from '../schemas/facturaCasetasSchema'
import * as repo from '../repositories/facturasCasetasRepo'
import * as service from '../services/facturasCasetasService'

/**
 * Un aumento: una vigencia nueva para un tramo. La anterior se queda, para que
 * los cruces de antes se sigan revisando contra el precio de su día.
 */
export async function tarifasCasetasCreate(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const body = TarifaCreateSchema.parse(await req.json())
    const id = await service.crearTarifa(body)
    const despues = await repo.findTarifa(id)

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'tarifas_casetas',
      registroId: id,
      despues: despues ? { ...despues } : null,
      descripcion: `Registró la tarifa de ${despues?.tramo ?? 'un tramo'} desde el ${body.vigente_desde}`,
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: { id } } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('tarifas-casetas-create', {
  methods: ['POST'],
  route: 'tarifas-casetas',
  authLevel: 'anonymous',
  handler: tarifasCasetasCreate,
})
