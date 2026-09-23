import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/programaService'
import { OperacionCreateSchema } from '../schemas/programaSchema'

export async function programaOperacionCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const programaId = parseInt(req.params.programaId, 10)
    if (isNaN(programaId)) return { status: 400, jsonBody: { error: 'ID de programa inválido' } }
    const body = OperacionCreateSchema.parse(await req.json())
    const created = await service.createOperacion(programaId, body)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'programa_operaciones',
      registroId: created.id,
      despues: await capturar('programa_operaciones', created.id),
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('programa-operacion-create', {
  methods: ['POST'],
  route: 'programa/{programaId}/operaciones',
  authLevel: 'anonymous',
  handler: programaOperacionCreate,
})
