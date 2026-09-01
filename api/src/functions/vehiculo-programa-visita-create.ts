// Cerrar la visita que toca: la unidad entró al taller e hizo la columna
// completa. Pone al día de un golpe todos los renglones que esa columna manda,
// que es justamente lo que significa que el kilometraje sea grupal.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/programaVehiculoService'
import { VisitaSchema } from '../schemas/programaVehiculoSchema'

export async function vehiculoProgramaVisitaCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const body = VisitaSchema.parse(await req.json())
    const estado = await service.registrarVisita(vehiculoId, body)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'vehiculo_programa_visita',
      registroId: vehiculoId,
      despues: { vehiculo_id: vehiculoId, ...body },
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: estado } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculo-programa-visita-create', {
  methods: ['POST'],
  route: 'vehiculos/{vehiculoId}/programa/visitas',
  authLevel: 'anonymous',
  handler: vehiculoProgramaVisitaCreate,
})
