import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/inventarioService'

export async function inventarioMinimoDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    await service.removeMinimo(id)

    await audit({
      user, accion: 'ELIMINAR', tabla: 'minimos_sucursal',
      registroId: id, ipAddress: getClientIp(req),
    })

    return { status: 204 }
  } catch (err) { return handleError(err, ctx) }
}

app.http('inventario-minimo-delete', {
  methods: ['DELETE'],
  route: 'inventario/minimos/{id}',
  authLevel: 'anonymous',
  handler: inventarioMinimoDelete,
})
