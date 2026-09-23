import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, exigirVehiculo } from '../shared/alcance'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import * as service from '../services/chequeosService'
import { ChequeoCreateSchema } from '../schemas/chequeoSchema'

export async function chequeosCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'responsable')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    await exigirVehiculo(vehiculoId, await alcanceDe(user))
    const body = ChequeoCreateSchema.parse(await req.json())
    // Quien captura sale de la sesión; el chofer que declara viaja en el cuerpo.
    // Son dos personas distintas y por eso son dos campos.
    const { chequeo, avisos } = await service.create(vehiculoId, body, await nombreOCorreo(user))
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'chequeos',
      registroId: chequeo.id,
      despues: await capturar('chequeos', chequeo.id),
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: chequeo, avisos } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('chequeos-create', {
  methods: ['POST'],
  route: 'vehiculos/{vehiculoId}/chequeos',
  authLevel: 'anonymous',
  handler: chequeosCreate,
})
