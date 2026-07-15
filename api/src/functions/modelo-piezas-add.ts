import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/piezasModeloService'

const Schema = z.object({
  pieza_ids: z.array(z.coerce.number().int().positive()).min(1, 'Selecciona al menos una pieza'),
})

export async function modeloPiezasAdd(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const { pieza_ids } = Schema.parse(await request.json())
    await service.addPiezas(id, pieza_ids)

    await audit({
      user, accion: 'EDITAR', tabla: 'piezas_modelo',
      registroId: id, detalles: { agregar_piezas: pieza_ids },
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('modelo-piezas-add', {
  methods: ['POST'],
  route: 'modelos/{id}/piezas',
  authLevel: 'anonymous',
  handler: modeloPiezasAdd,
})
