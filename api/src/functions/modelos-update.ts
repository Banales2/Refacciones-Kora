import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/modelosService'

const Schema = z.object({
  marca:  z.string().min(1).max(80).trim().optional(),
  nombre: z.string().min(1).max(120).trim().optional(),
})

export async function modelosUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const { marca, nombre } = Schema.parse(await req.json())
    const updated = await service.update(id, marca, nombre)
    await audit({ user, accion: 'EDITAR', tabla: 'modelos', registroId: id, ipAddress: getClientIp(req) })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('modelos-update', { methods: ['PUT', 'PATCH'], route: 'modelos/{id}', authLevel: 'anonymous', handler: modelosUpdate })
