import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, exigirFilaDeVehiculo } from '../shared/alcance'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import * as service from '../services/chequeosService'
import { ChequeoUpdateSchema } from '../schemas/chequeoSchema'

// Corregir el chequeo del día. No hay alta de un segundo chequeo para la misma
// unidad y fecha (el índice único no lo permite): lo que estaba mal se corrige,
// y la bitácora guarda cómo estaba antes.
export async function chequeosUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'responsable')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    await exigirFilaDeVehiculo('chequeos', id, await alcanceDe(user))
    const body = ChequeoUpdateSchema.parse(await req.json())

    const antes = await capturar('chequeos', id)
    const { chequeo, avisos } = await service.update(id, body, await nombreOCorreo(user))

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'chequeos',
      registroId: id,
      antes,
      despues: await capturar('chequeos', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: chequeo, avisos } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('chequeos-update', {
  methods: ['PUT'],
  route: 'chequeos/{id}',
  authLevel: 'anonymous',
  handler: chequeosUpdate,
})
