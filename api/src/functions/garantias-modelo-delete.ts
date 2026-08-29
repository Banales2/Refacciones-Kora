// Borrar la garantía del catálogo se lleva la copia de todas las unidades. Para
// dejar de darla solo en las nuevas, se desactiva en vez de borrarse.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/garantiasService'

export async function garantiasModeloDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const antes = await capturar('garantias_modelo', id)
    await service.removeModelo(id)
    await audit({
      user,
      accion: 'ELIMINAR',
      tabla: 'garantias_modelo',
      registroId: id,
      antes,
      ipAddress: getClientIp(req),
    })
    return { status: 204 }
  } catch (err) { return handleError(err, ctx) }
}

app.http('garantias-modelo-delete', {
  methods: ['DELETE'],
  route: 'garantias-modelo/{id}',
  authLevel: 'anonymous',
  handler: garantiasModeloDelete,
})
