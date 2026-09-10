import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { DetalleMttoPiezaCreateSchema } from '../schemas/detalleMttoPiezaSchema'
import * as service from '../services/detalleMttoPiezaService'

export async function detalleMttoCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const mantenimientoId = parseInt(req.params.id, 10)
    if (isNaN(mantenimientoId)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = DetalleMttoPiezaCreateSchema.parse(await req.json())
    const { detalle, montajeError, montajeAviso } = await service.create(mantenimientoId, body)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'detalle_mtto_pieza',
      registroId: detalle.id,
      despues: await capturar('detalle_mtto_pieza', detalle.id),
      detalles: { montajes: body.montajes?.length ?? 0 },
      ipAddress: getClientIp(req),
    })
    // El consumo se guardó aunque el montaje haya fallado: por eso es 201 con
    // aviso y no un error. Devolverlo como 4xx haría que el front diera por
    // perdido un gasto que sí quedó registrado.
    return {
      status: 201,
      jsonBody: { data: detalle, montaje_error: montajeError, montaje_aviso: montajeAviso },
    }
  } catch (err) { return handleError(err, ctx) }
}

app.http('detalle-mtto-create', {
  methods: ['POST'],
  route: 'mantenimientos/{id}/detalle',
  authLevel: 'anonymous',
  handler: detalleMttoCreate,
})
