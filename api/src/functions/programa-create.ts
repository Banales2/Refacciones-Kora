import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/programaService'
import { ProgramaCreateSchema } from '../schemas/programaSchema'

export async function programaCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const modeloId = parseInt(req.params.modeloId, 10)
    if (isNaN(modeloId)) return { status: 400, jsonBody: { error: 'ID de modelo inválido' } }
    const body = ProgramaCreateSchema.parse(await req.json())
    const created = await service.create(modeloId, body)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'programas_mantenimiento',
      registroId: created.id,
      despues: await capturar('programas_mantenimiento', created.id),
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('programa-create', {
  methods: ['POST'],
  route: 'modelos/{modeloId}/programa',
  authLevel: 'anonymous',
  handler: programaCreate,
})
