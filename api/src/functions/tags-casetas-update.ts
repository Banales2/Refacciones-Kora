import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { TagUpdateSchema } from '../schemas/facturaCasetasSchema'
import * as repo from '../repositories/facturasCasetasRepo'
import * as service from '../services/facturasCasetasService'

/**
 * Cambia la unidad de un tag. Sus cruces que no tenían unidad toman la nueva;
 * los que ya tenían una se quedan con ella, porque eran de quien lo traía
 * entonces.
 */
export async function tagsCasetasUpdate(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = TagUpdateSchema.parse(await req.json())

    const antes = await repo.findTag(id)
    const ligados = await service.actualizarTag(id, body)
    const despues = await repo.findTag(id)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'tags_casetas',
      registroId: id,
      antes: antes ? { tag: antes.tag, vehiculo: antes.vehiculo, nota: antes.nota } : undefined,
      despues: despues ? { tag: despues.tag, vehiculo: despues.vehiculo, nota: despues.nota } : undefined,
      detalles: { cruces_ligados: ligados },
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: { id, cruces_ligados: ligados } } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('tags-casetas-update', {
  methods: ['PUT'],
  route: 'tags-casetas/{id}',
  authLevel: 'anonymous',
  handler: tagsCasetasUpdate,
})
