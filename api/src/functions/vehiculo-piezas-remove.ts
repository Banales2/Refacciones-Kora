import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/piezasVehiculoService'

// Con qué se cierra el renglón de la bitácora. Todo opcional: quitar una pieza
// sin explicar por qué sigue siendo válido, solo pierde el motivo.
const Retiro = z.object({
  fecha_retiro:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (AAAA-MM-DD)').optional(),
  km_retiro:     z.coerce.number().int().nonnegative().optional(),
  motivo_retiro: z.enum(['desgaste', 'falla', 'robo', 'siniestro', 'preventivo', 'garantia']).optional(),
  destino:       z.enum(['desecho', 'reacondicionar', 'devolucion_proveedor', 'venta', 'stock']).optional(),
})

export async function vehiculoPiezasRemove(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id     = parseInt(request.params.id, 10)
    const tipoId = parseInt(request.params.tipoId, 10)
    if (isNaN(id) || isNaN(tipoId)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    // Los datos del retiro van por query string y no en el cuerpo: un DELETE
    // con body no lo manejan igual todos los clientes ni todos los proxies.
    const q = request.query
    const datos = Retiro.parse({
      fecha_retiro:  q.get('fecha_retiro')  ?? undefined,
      km_retiro:     q.get('km_retiro')     ?? undefined,
      motivo_retiro: q.get('motivo_retiro') ?? undefined,
      destino:       q.get('destino')       ?? undefined,
    })
    await service.removePieza(id, tipoId, datos)

    await audit({
      user, accion: 'EDITAR', tabla: 'piezas_vehiculo',
      registroId: id, detalles: { quitar_tipo: tipoId, ...datos },
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('vehiculo-piezas-remove', {
  methods: ['DELETE'],
  route: 'vehiculos/{id}/piezas/{tipoId}',
  authLevel: 'anonymous',
  handler: vehiculoPiezasRemove,
})
