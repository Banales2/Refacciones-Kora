// Alta de una garantía en el catálogo del modelo. Se copia en seguida a todas
// las unidades de ese modelo que todavía no la tienen.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/garantiasService'
import { GarantiaModeloCreateSchema } from '../schemas/garantiaSchema'

export async function garantiasModeloCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const modeloId = parseInt(req.params.modeloId, 10)
    if (isNaN(modeloId)) return { status: 400, jsonBody: { error: 'ID de modelo inválido' } }
    const body = GarantiaModeloCreateSchema.parse(await req.json())
    const created = await service.createModelo(modeloId, body)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'garantias_modelo',
      registroId: created.id,
      despues: await capturar('garantias_modelo', created.id),
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('garantias-modelo-create', {
  methods: ['POST'],
  route: 'modelos/{modeloId}/garantias',
  authLevel: 'anonymous',
  handler: garantiasModeloCreate,
})
