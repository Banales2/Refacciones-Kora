// Editar la garantía del catálogo sincroniza la copia de todas las unidades del
// modelo, sin tocar el arranque ni la cancelación de cada una.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/garantiasService'
import { GarantiaModeloUpdateSchema } from '../schemas/garantiaSchema'

export async function garantiasModeloUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = GarantiaModeloUpdateSchema.parse(await req.json())
    const antes = await capturar('garantias_modelo', id)
    const updated = await service.updateModelo(id, body)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'garantias_modelo',
      registroId: id,
      antes,
      despues: await capturar('garantias_modelo', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('garantias-modelo-update', {
  methods: ['PUT', 'PATCH'],
  route: 'garantias-modelo/{id}',
  authLevel: 'anonymous',
  handler: garantiasModeloUpdate,
})
