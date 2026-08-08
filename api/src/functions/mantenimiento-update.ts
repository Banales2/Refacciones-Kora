import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { TEXTO_LIBRE, KM_MAX } from '../schemas/common'
import * as service from '../services/mantenimientoService'

const Schema = z.object({
  fecha:             z.string().date().optional(),
  tipo:              z.enum(['Preventivo', 'Correctivo']).optional(),
  tecnico_id:        z.coerce.number().int().positive('Técnico requerido').optional(),
  costo:             z.coerce.number().min(0).optional(),
  km_actual:         z.coerce.number().int().min(0).max(KM_MAX, 'Máximo 9,999,999 km').optional(),
  observaciones:     z.string().trim().min(1, 'Observaciones requeridas').max(255, 'Máximo 255 caracteres')
                       .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos').optional(),
  pendiente_ids: z.array(z.number().int().positive()).min(1, 'Selecciona al menos un requerimiento o incidencia').optional(),
})

export async function mantenimientoUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = Schema.parse(await req.json())
    const antes = await capturar('mantenimiento', id)
    const updated = await service.update(id, body)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'mantenimiento',
      registroId: id,
      antes,
      despues: await capturar('mantenimiento', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('mantenimiento-update', {
  methods: ['PUT'],
  route: 'mantenimientos/{id}',
  authLevel: 'anonymous',
  handler: mantenimientoUpdate,
})
