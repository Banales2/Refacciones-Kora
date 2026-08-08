import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/incidenciasService'
import { IncidenciaCreateSchema } from '../schemas/incidenciaSchema'

export async function incidenciasCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const body = IncidenciaCreateSchema.parse(await req.json())
    // Quien registra la incidencia es quien la autoriza: sale de la sesión, no
    // del cuerpo, para que nadie pueda darla de alta a nombre de otro.
    const created = await service.create(vehiculoId, body, user.userDetails)
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
