import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/tiposPiezaModeloService'
import { EtiquetaPiezaSchema } from '../schemas/tipoPiezaSchema'

// Renombra la posición de un renglón de la plantilla. Las dos etiquetas van en
// el cuerpo: la actual identifica cuál de los renglones de ese tipo se toca, y
// ninguna de las dos cabe en la ruta porque la vacía no tiene representación en
// un segmento de URL.
const Schema = z.object({
  etiqueta:       EtiquetaPiezaSchema,
  etiqueta_nueva: EtiquetaPiezaSchema,
})

export async function modeloTiposPiezaRename(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id     = parseInt(request.params.id, 10)
    const tipoId = parseInt(request.params.tipoId, 10)
    if (isNaN(id) || isNaN(tipoId)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const { etiqueta, etiqueta_nueva } = Schema.parse(await request.json())
    await service.renameEtiqueta(id, tipoId, etiqueta, etiqueta_nueva)

    await audit({
      user, accion: 'EDITAR', tabla: 'tipos_pieza_modelo',
      registroId: id, detalles: { tipo_pieza_id: tipoId, etiqueta, etiqueta_nueva },
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('modelo-tipos-pieza-rename', {
  methods: ['PUT'],
  route: 'modelos/{id}/tipos-pieza/{tipoId}',
  authLevel: 'anonymous',
  handler: modeloTiposPiezaRename,
})
