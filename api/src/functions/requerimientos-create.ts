import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/requerimentosService'

const Schema = z.object({
  nombre:          z.string().min(1, 'Requerido').max(120).trim(),
  descripcion:     z.string().max(5000).trim().nullable().optional(),
  categoria:       z.string().max(80).trim().nullable().optional(),
  trigger_mode:    z.enum(['km', 'meses', 'ambos']),
  tipo:            z.enum(['recurrente', 'unica']).default('recurrente'),
  intervalo_km:    z.coerce.number().int().positive().nullable().optional(),
  intervalo_meses: z.coerce.number().int().positive().nullable().optional(),
  intervalo_dias:  z.coerce.number().int().positive().nullable().optional(),
  status:          z.enum(['activo', 'completado', 'pausado', 'cancelado']).default('activo'),
  fecha_inicio:    z.string().date().nullable().optional(),
  km_inicio:       z.coerce.number().int().min(0).nullable().optional(),
  fecha_reporte:   z.string().date().nullable().optional(),
})

export async function requerimientosCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const body = Schema.parse(await req.json())
    const created = await service.create(vehiculoId, body)
    await audit({ user, accion: 'CREAR', tabla: 'requerimientos_exclusivos', registroId: created.id, ipAddress: getClientIp(req) })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('requerimientos-create', {
  methods: ['POST'],
  route: 'vehiculos/{vehiculoId}/requerimientos',
  authLevel: 'anonymous',
  handler: requerimientosCreate,
})
