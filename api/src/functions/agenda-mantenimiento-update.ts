import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/agendaMantenimientoService'

const Schema = z.object({
  fecha_inicio:      z.string().date().optional(),
  fecha_fin:         z.string().date().optional(),
  tipo:              z.enum(['Preventivo', 'Correctivo']).optional(),
  tecnico_id:        z.coerce.number().int().positive('Técnico requerido').optional(),
  observaciones:     z.string().trim().nullable().optional(),
  requerimiento_ids: z.array(z.number().int().positive()).min(1, 'Selecciona al menos un requerimiento').optional(),
})

export async function agendaMantenimientoUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = Schema.parse(await req.json())
    const antes = await capturar('agendas_mantenimiento', id)
    const updated = await service.update(id, body)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'agendas_mantenimiento',
      registroId: id,
      antes,
      despues: await capturar('agendas_mantenimiento', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('agenda-mantenimiento-update', {
  methods: ['PUT', 'PATCH'],
  route: 'agendas-mantenimiento/{id}',
  authLevel: 'anonymous',
  handler: agendaMantenimientoUpdate,
})
