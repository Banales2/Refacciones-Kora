import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { MinimoCreateSchema } from '../schemas/inventarioSchema'
import * as service from '../services/inventarioService'

export async function inventarioMinimoCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const data = MinimoCreateSchema.parse(await req.json())
    const created = await service.createMinimo(data)

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'minimos_sucursal',
      registroId: created.id,
      detalles: { sucursal: created.sucursal, pieza: created.numero_serie, minimo: created.minimo },
      ipAddress: getClientIp(req),
    })

    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('inventario-minimo-create', {
  methods: ['POST'],
  route: 'inventario/minimos',
  authLevel: 'anonymous',
  handler: inventarioMinimoCreate,
})
