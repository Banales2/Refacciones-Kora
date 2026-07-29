import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/tiposPiezaModeloService'

const Schema = z.object({
  tipo_pieza_ids: z.array(z.coerce.number().int().positive()).min(1, 'Selecciona al menos un tipo de pieza'),
})

export async function modeloTiposPiezaAdd(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const { tipo_pieza_ids } = Schema.parse(await request.json())
    await service.addTipos(id, tipo_pieza_ids)

    await audit({
      user, accion: 'EDITAR', tabla: 'tipos_pieza_modelo',
      registroId: id, detalles: { agregar_tipos: tipo_pieza_ids },
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('modelo-tipos-pieza-add', {
  methods: ['POST'],
  route: 'modelos/{id}/tipos-pieza',
  authLevel: 'anonymous',
  handler: modeloTiposPiezaAdd,
})
