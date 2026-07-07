import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/mantenimientoService'

const Schema = z.object({
  fecha:         z.string().date(),
  tipo:          z.string().max(80).trim().nullable().optional(),
  tecnico:       z.string().max(120).trim().nullable().optional(),
  costo:         z.coerce.number().int().min(0).default(0),
  km_actual:     z.coerce.number().int().min(0).default(0),
  observaciones: z.string().trim().nullable().optional(),
})

export async function mantenimientoCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const body = Schema.parse(await req.json())
    const created = await service.create(vehiculoId, body)
    await audit({ user, accion: 'CREAR', tabla: 'mantenimiento', registroId: created.id, ipAddress: getClientIp(req) })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('mantenimiento-create', {
  methods: ['POST'],
  route: 'vehiculos/{vehiculoId}/mantenimientos',
  authLevel: 'anonymous',
  handler: mantenimientoCreate,
})
