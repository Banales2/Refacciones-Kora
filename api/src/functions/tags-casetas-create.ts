import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { TagCreateSchema } from '../schemas/facturaCasetasSchema'
import * as service from '../services/facturasCasetasService'

/**
 * Registra un tag antes de que aparezca en una factura. Los que llegan en una
 * factura se dan de alta solos, sin unidad.
 */
export async function tagsCasetasCreate(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const body = TagCreateSchema.parse(await req.json())
    const id = await service.crearTag(body)

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'tags_casetas',
      registroId: id,
      despues: { tag: body.tag, vehiculo_id: body.vehiculo_id, nota: body.nota ?? null },
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: { id } } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('tags-casetas-create', {
  methods: ['POST'],
  route: 'tags-casetas',
  authLevel: 'anonymous',
  handler: tagsCasetasCreate,
})
