import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { TEXTO_LIBRE, KM_MAX } from '../schemas/common'
import * as service from '../services/mantenimientoService'

const Schema = z.object({
  fecha:             z.string().date(),
  tipo:              z.enum(['Preventivo', 'Correctivo']),
  tecnico_id:        z.coerce.number({ error: 'Técnico requerido' }).int().positive('Técnico requerido'),
  costo:             z.coerce.number({ error: 'Costo requerido' }).min(0),
  km_actual:         z.coerce.number({ error: 'Kilometraje requerido' }).int().min(0).max(KM_MAX, 'Máximo 9,999,999 km'),
  observaciones:     z.string().trim().min(1, 'Observaciones requeridas').max(255, 'Máximo 255 caracteres')
                       .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos'),
  // TEMPORAL — mantenimiento sin origen. El vínculo era obligatorio (.min(1)) y
  // volverá a serlo: se suspendió para poder capturar mantenimientos antiguos
  // cuya razón ya no se conserva. Para reactivarlo, devolver el .min(1) aquí y
  // en los demás puntos marcados: `grep -rn "mantenimiento sin origen"`.
  pendiente_ids: z.array(z.number().int().positive()),
})

export async function mantenimientoCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const body = Schema.parse(await req.json())
    const created = await service.create(vehiculoId, body)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'mantenimiento',
      registroId: created.id,
      despues: await capturar('mantenimiento', created.id),
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('mantenimiento-create', {
  methods: ['POST'],
  route: 'vehiculos/{vehiculoId}/mantenimientos',
  authLevel: 'anonymous',
  handler: mantenimientoCreate,
})
