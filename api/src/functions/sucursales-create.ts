import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/sucursalesService'

const Schema = z.object({
  nombre:    z.string().min(1, 'Requerido').max(120).trim(),
  ubicacion: z.string().min(1, 'Requerido').max(200).trim(),
})

export async function sucursalesCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const { nombre, ubicacion } = Schema.parse(await req.json())
    const created = await service.create(nombre, ubicacion)
    await audit({ user, accion: 'CREAR', tabla: 'sucursales', registroId: created.id, ipAddress: getClientIp(req) })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('sucursales-create', { methods: ['POST'], route: 'sucursales', authLevel: 'anonymous', handler: sucursalesCreate })
