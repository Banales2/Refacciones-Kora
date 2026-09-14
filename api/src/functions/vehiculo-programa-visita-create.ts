// Cerrar la visita que toca: la unidad entró al taller e hizo la columna que le
// tocaba. Viene con el acta —cómo terminó cada renglón—, y todo lo que no se
// saltó queda al día, tanto lo atendido como lo que solo se revisó. Lo omitido
// se guarda con su motivo y sigue vencido (migración 031).
//
// Lo que se manda es el mantenimiento que la pagó, no una visita: son el mismo
// hecho (migración 017). El mantenimiento se registra antes, por su camino
// normal, con su costo y sus piezas.
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
      accion: 'EDITAR',
      tabla: 'mantenimiento',
      registroId: body.mantenimiento_id,
      despues: {
        vehiculo_id: vehiculoId,
        cerro_servicio_del_programa: true,
        // Lo que se saltó y lo que sí se cambió: es lo que vale la pena poder
        // rastrear después. Lo revisado sin novedad es el relleno de siempre.
        operaciones_atendidas: body.operaciones.filter((o) => o.resultado === 'atendida').length,
        operaciones_omitidas:  body.operaciones.filter((o) => o.resultado === 'omitida').length,
      },
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
