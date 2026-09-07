// Lo que una unidad hace distinto del programa de su modelo: correrle la marca
// de una columna, apagarle un renglón que no le aplica, cambiarle un límite de
// meses.
//
// Llega entero, como reemplazo: es una cuadrícula que se edita marcando y
// desmarcando, no un parche campo por campo. Lo que repite al catálogo no se
// guarda —lo descarta el servicio—, para que una corrección al programa del
// modelo siga alcanzando a la unidad en todo lo que no tocó.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/programaVehiculoService'
import { ExcepcionesSchema } from '../schemas/programaVehiculoSchema'

export async function vehiculoProgramaExcepciones(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const body = ExcepcionesSchema.parse(await req.json())
    const estado = await service.setExcepciones(vehiculoId, {
      fases: body.fases.map((f) => ({
        fase_id: f.fase_id, km: f.km ?? null, costo: f.costo ?? null, omitida: f.omitida,
      })),
      operaciones: body.operaciones.map((o) => ({
        operacion_id: o.operacion_id, activa: o.activa, limite_meses: o.limite_meses ?? null,
      })),
    })
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'vehiculo_programa',
      registroId: vehiculoId,
      despues: { excepciones: estado?.excepciones },
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: estado } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculo-programa-excepciones', {
  methods: ['PUT'],
  route: 'vehiculos/{vehiculoId}/programa/excepciones',
  authLevel: 'anonymous',
  handler: vehiculoProgramaExcepciones,
})
