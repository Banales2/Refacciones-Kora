import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { TEXTO_LIBRE } from '../schemas/common'
import * as service from '../services/agendaMantenimientoService'

const Schema = z.object({
  fecha:             z.string().date(),
  tipo:              z.enum(['Preventivo', 'Correctivo']),
  tecnico_id:        z.coerce.number({ error: 'Técnico requerido' }).int().positive('Técnico requerido'),
  costo:             z.coerce.number({ error: 'Costo requerido' }).min(0),
  km_actual:         z.coerce.number({ error: 'Kilometraje requerido' }).int().min(0),
  observaciones:     z.string().trim().min(1, 'Observaciones requeridas').max(255, 'Máximo 255 caracteres')
                       .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos'),
  pendiente_ids: z.array(z.number().int().positive()).min(1, 'Selecciona al menos un requerimiento o incidencia'),
})

export async function agendaMantenimientoCompletar(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = Schema.parse(await req.json())
    const mantenimiento = await service.completar(id, body)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'mantenimiento',
      registroId: mantenimiento.id,
      despues: await capturar('mantenimiento', mantenimiento.id),
      detalles: { agenda_id: id },
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: mantenimiento } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('agenda-mantenimiento-completar', {
  methods: ['POST'],
  route: 'agendas-mantenimiento/{id}/completar',
  authLevel: 'anonymous',
  handler: agendaMantenimientoCompletar,
})
