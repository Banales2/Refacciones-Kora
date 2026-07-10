import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/agendaMantenimientoService'

const Schema = z.object({
  fecha:             z.string().date(),
  tipo:              z.string().max(80).trim().nullable().optional(),
  tecnico:           z.string().max(120).trim().nullable().optional(),
  costo:             z.coerce.number().int().min(0).default(0),
  km_actual:         z.coerce.number().int().min(0).default(0),
  observaciones:     z.string().trim().nullable().optional(),
  requerimiento_ids: z.array(z.number().int().positive()).optional(),
})

export async function agendaMantenimientoCompletar(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = Schema.parse(await req.json())
    const mantenimiento = await service.completar(id, body)
    await audit({ user, accion: 'CREAR', tabla: 'mantenimiento', registroId: mantenimiento.id, detalles: { agenda_id: id }, ipAddress: getClientIp(req) })
    return { status: 201, jsonBody: { data: mantenimiento } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('agenda-mantenimiento-completar', {
  methods: ['POST'],
  route: 'agendas-mantenimiento/{id}/completar',
  authLevel: 'anonymous',
  handler: agendaMantenimientoCompletar,
})
