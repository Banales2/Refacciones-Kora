import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { TramoCreateSchema } from '../schemas/facturaCasetasSchema'
import * as service from '../services/facturasCasetasService'

/** Un tramo nuevo, las casetas de PASE que lo cobran y su primera tarifa. */
export async function tramosCasetasCreate(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const body = TramoCreateSchema.parse(await req.json())
    const r = await service.crearTramo(body)

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'tramos_casetas',
      registroId: r.tramo_id,
      despues: body,
      descripcion: `Agregó el tramo ${body.nombre} (${body.autopista}) a la caseta ${body.casetas.join(', ')}`,
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: r } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('tramos-casetas-create', {
  methods: ['POST'],
  route: 'tramos-casetas',
  authLevel: 'anonymous',
  handler: tramosCasetasCreate,
})
