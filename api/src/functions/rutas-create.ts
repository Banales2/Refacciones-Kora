import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/rutasService'

const Schema = z.object({
  nombre:    z.string().min(1, 'Requerido').max(120).trim(),
  ubicacion: z.string().min(1, 'Requerido').max(200).trim(),
})

export async function rutasCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const { nombre, ubicacion } = Schema.parse(await req.json())
    const created = await service.create(nombre, ubicacion)
    await audit({ user, accion: 'CREAR', tabla: 'rutas', registroId: created.id, ipAddress: getClientIp(req) })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('rutas-create', { methods: ['POST'], route: 'rutas', authLevel: 'anonymous', handler: rutasCreate })
