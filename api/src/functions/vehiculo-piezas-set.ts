import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/piezasVehiculoService'

const Schema = z.object({
  pieza_id: z.coerce.number().int().positive(),
})

export async function vehiculoPiezasSet(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id     = parseInt(request.params.id, 10)
    const tipoId = parseInt(request.params.tipoId, 10)
    if (isNaN(id) || isNaN(tipoId)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const { pieza_id } = Schema.parse(await request.json())
    await service.setPieza(id, tipoId, pieza_id)

    await audit({
      user, accion: 'EDITAR', tabla: 'piezas_vehiculo',
      registroId: id, detalles: { tipo_pieza_id: tipoId, pieza_id },
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('vehiculo-piezas-set', {
  methods: ['PUT'],
  route: 'vehiculos/{id}/piezas/{tipoId}',
  authLevel: 'anonymous',
  handler: vehiculoPiezasSet,
})
