import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { LoteCreateSchema } from '../schemas/loteSchema'
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
    const created = await service.createLote(piezaId, body)

    await audit({
      user, accion: 'CREAR', tabla: 'lotes_pieza',
      registroId: created.id,
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
