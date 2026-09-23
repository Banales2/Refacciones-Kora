import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError, NotFoundError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as repo from '../repositories/unidadesPiezaRepo'

// El folio físico pegado a la pieza. Es lo único de una unidad que se captura a
// mano: todo lo demás —dónde está, si es nueva o usada, cuánto lleva recorrido—
// sale de su historial y no se edita.
const Schema = z.object({
  etiqueta: z
    .string()
    .trim()
    .max(40, 'Máximo 40 caracteres')
    .transform((v) => v || null)
    .nullable(),
})

export async function unidadEtiquetaUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const { etiqueta } = Schema.parse(await request.json())
    if (!(await repo.setEtiqueta(id, etiqueta))) throw new NotFoundError('Unidad')

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'unidades_pieza',
      registroId: id,
      detalles: { etiqueta },
      ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: { id, etiqueta } } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('unidad-etiqueta-update', {
  methods: ['PUT'],
  route: 'unidades/{id}/etiqueta',
  authLevel: 'anonymous',
  handler: unidadEtiquetaUpdate,
})
