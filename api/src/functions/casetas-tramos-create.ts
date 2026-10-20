import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { CasetaTramoCreateSchema } from '../schemas/facturaCasetasSchema'
import * as service from '../services/facturasCasetasService'

/** Liga un tramo que ya existe a una caseta de PASE. Solo admin, como las tarifas. */
export async function casetasTramosCreate(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const body = CasetaTramoCreateSchema.parse(await req.json())
    await service.ligarTramo(body.caseta, body.tramo_id)

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'casetas_tramos',
      registroId: `${body.caseta}-${body.tramo_id}`,
      despues: body,
      descripcion: `Ligó el tramo #${body.tramo_id} a la caseta ${body.caseta}`,
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: body } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('casetas-tramos-create', {
  methods: ['POST'],
  route: 'casetas-tramos',
  authLevel: 'anonymous',
  handler: casetasTramosCreate,
})
