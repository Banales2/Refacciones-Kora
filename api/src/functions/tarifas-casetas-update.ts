import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { TarifaUpdateSchema } from '../schemas/facturaCasetasSchema'
import * as repo from '../repositories/facturasCasetasRepo'
import * as service from '../services/facturasCasetasService'

/**
 * Corrige una vigencia: sus precios o su fecha. Solo admin: estas tarifas
 * deciden qué cuenta como cobro de más en todas las facturas, las ya revisadas
 * incluidas.
 */
export async function tarifasCasetasUpdate(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = TarifaUpdateSchema.parse(await req.json())

    const antes = await repo.findTarifa(id)
    await service.actualizarTarifa(id, body)
    const despues = await repo.findTarifa(id)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'tarifas_casetas',
      registroId: id,
      antes: antes ? { ...antes } : null,
      despues: despues ? { ...despues } : null,
      descripcion: `Corrigió la tarifa de ${antes?.tramo ?? 'un tramo'} (${antes?.autopista ?? ''})`,
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: { id } } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('tarifas-casetas-update', {
  methods: ['PUT'],
  route: 'tarifas-casetas/{id}',
  authLevel: 'anonymous',
  handler: tarifasCasetasUpdate,
})
