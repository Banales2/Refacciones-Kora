import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/tiposPiezaModeloService'
import { EtiquetaPiezaSchema } from '../schemas/tipoPiezaSchema'

export async function modeloTiposPiezaRemove(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id     = parseInt(request.params.id, 10)
    const tipoId = parseInt(request.params.tipoId, 10)
    if (isNaN(id) || isNaN(tipoId)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    // Qué renglón del tipo se quita. Va por query string y no en la ruta porque
    // la etiqueta vacía —el caso normal— no tiene representación en un segmento
    // de URL.
    const etiqueta = EtiquetaPiezaSchema.parse(request.query.get('etiqueta') ?? '')
    await service.removeTipo(id, tipoId, etiqueta)

    await audit({
      user, accion: 'EDITAR', tabla: 'tipos_pieza_modelo',
      registroId: id, detalles: { quitar_tipo: tipoId, etiqueta },
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('modelo-tipos-pieza-remove', {
  methods: ['DELETE'],
  route: 'modelos/{id}/tipos-pieza/{tipoId}',
  authLevel: 'anonymous',
  handler: modeloTiposPiezaRemove,
})
