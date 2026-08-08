import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { LoteCreateSchema } from '../schemas/loteSchema'
import { nombreOCorreo } from '../shared/usuario'
import * as service from '../services/lotesService'

export async function loteCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const piezaId = parseInt(request.params.id, 10)
    if (isNaN(piezaId)) return { status: 400, jsonBody: { error: 'ID de pieza inválido' } }

    const body = LoteCreateSchema.parse(await request.json())
    // Quien registra la compra es quien la autoriza: sale de la sesión, no del
    // cuerpo, para que no pueda quedar a nombre de otro.
    const created = await service.createLote(piezaId, body, await nombreOCorreo(user))

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'lotes_pieza',
      registroId: created.id,
      despues: await capturar('lotes_pieza', created.id),
      detalles: { pieza_id: piezaId, cantidad_inicial: created.cantidad_inicial },
      ipAddress: getClientIp(request),
    })

    return { status: 201, jsonBody: { data: created } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('lote-create', {
  methods: ['POST'],
  route: 'piezas/{id}/lotes',
  authLevel: 'anonymous',
  handler: loteCreate,
})
