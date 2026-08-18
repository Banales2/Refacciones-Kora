import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { MinimoUpdateSchema } from '../schemas/inventarioSchema'
import * as service from '../services/inventarioService'

export async function inventarioMinimoUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const data = MinimoUpdateSchema.parse(await req.json())
    const updated = await service.updateMinimo(id, data)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'minimos_sucursal',
      registroId: id,
      detalles: { sucursal: updated.sucursal, pieza: updated.numero_serie, minimo: updated.minimo },
      ipAddress: getClientIp(req),
    })

    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('inventario-minimo-update', {
  methods: ['PUT'],
  route: 'inventario/minimos/{id}',
  authLevel: 'anonymous',
  handler: inventarioMinimoUpdate,
})
