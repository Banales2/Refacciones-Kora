import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/modelosService'

const Schema = z.object({
  marca:  z.string().min(1, 'Requerido').max(80).trim(),
  nombre: z.string().min(1, 'Requerido').max(80).trim(),
})

export async function modelosCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const { marca, nombre } = Schema.parse(await req.json())
    const created = await service.create(marca, nombre)
    await audit({ user, accion: 'CREAR', tabla: 'modelos', registroId: created.id, ipAddress: getClientIp(req) })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('modelos-create', { methods: ['POST'], route: 'modelos', authLevel: 'anonymous', handler: modelosCreate })
