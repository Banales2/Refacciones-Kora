import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { TraspasoCreateSchema } from '../schemas/inventarioSchema'
import * as service from '../services/inventarioService'

// Mover piezas de un lote de una sucursal a otra. El movimiento del stock y el
// registro del traspaso van en la misma transacción del repositorio.
export async function inventarioTraspasoCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const data = TraspasoCreateSchema.parse(await req.json())
    const created = await service.createTraspaso(data, user.userDetails)

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'traspasos_pieza',
      registroId: created.id,
      detalles: {
        pieza: created.numero_serie,
        de: created.origen,
        a: created.destino,
        cantidad: created.cantidad,
      },
      ipAddress: getClientIp(req),
    })

    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('inventario-traspaso-create', {
  methods: ['POST'],
  route: 'inventario/traspasos',
  authLevel: 'anonymous',
  handler: inventarioTraspasoCreate,
})
