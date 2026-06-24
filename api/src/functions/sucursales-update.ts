import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/sucursalesService'

const Schema = z.object({
  nombre:    z.string().min(1).max(120).trim().optional(),
  ubicacion: z.string().min(1).max(200).trim().optional(),
})

export async function sucursalesUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const { nombre, ubicacion } = Schema.parse(await req.json())
    const updated = await service.update(id, nombre, ubicacion)
    await audit({ user, accion: 'EDITAR', tabla: 'sucursales', registroId: id, ipAddress: getClientIp(req) })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('sucursales-update', { methods: ['PUT', 'PATCH'], route: 'sucursales/{id}', authLevel: 'anonymous', handler: sucursalesUpdate })
