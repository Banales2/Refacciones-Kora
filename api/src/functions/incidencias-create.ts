import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { AuthError, requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, exigirVehiculo } from '../shared/alcance'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import * as service from '../services/incidenciasService'
import { IncidenciaCreateSchema } from '../schemas/incidenciaSchema'

export async function incidenciasCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'responsable')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    await exigirVehiculo(vehiculoId, await alcanceDe(user))
    const body = IncidenciaCreateSchema.parse(await req.json())
    // El responsable reporta; darla de alta ya atendida, pausada o cancelada es
    // cerrarla, y eso es de quien registra el mantenimiento.
    if (user.userRoles.includes('responsable') && body.status !== 'activo') {
      throw new AuthError('Solo puedes reportar incidencias sin atender', 403)
    }
    // Quien registra la incidencia es quien la autoriza: sale de la sesión, no
    // del cuerpo, para que nadie pueda darla de alta a nombre de otro.
    const created = await service.create(vehiculoId, body, await nombreOCorreo(user))
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'incidencias',
      registroId: created.id,
      despues: await capturar('incidencias', created.id),
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('incidencias-create', {
  methods: ['POST'],
  route: 'vehiculos/{vehiculoId}/incidencias',
  authLevel: 'anonymous',
  handler: incidenciasCreate,
})
