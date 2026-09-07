import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { TEXTO_LIBRE, TEXTO_SIMPLE, KM_MAX } from '../schemas/common'
import * as service from '../services/mantenimientoService'

const Schema = z.object({
  fecha:             z.string().date().optional(),
  tipo:              z.enum(['Preventivo', 'Correctivo']).optional(),
  tecnico_id:        z.coerce.number().int().positive('Técnico requerido').optional(),
  costo:             z.coerce.number().min(0).optional(),
  km_actual:         z.coerce.number().int().min(0).max(KM_MAX, 'Máximo 9,999,999 km').optional(),
  observaciones:     z.string().trim().min(1, 'Observaciones requeridas').max(255, 'Máximo 255 caracteres')
                       .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos').optional(),
  // TEMPORAL — mantenimiento sin origen. Igual que en el alta: el .min(1) se
  // suspendió para los mantenimientos antiguos y volverá a ponerse.
  pendiente_ids: z.array(z.number().int().positive()).optional(),
  // Por qué entró la unidad al taller, varias a la vez: un servicio del
  // programa entra por PREVENCIÓN y de paso se le atiende la fuga que traía.
  // Es otra cosa que `tipo`, que clasifica el gasto.
  //
  // TEMPORAL — mantenimiento sin razón. Va a ser obligatorio (.min(1)) en
  // cuanto el vocabulario se acomode; hoy se admite vacío para no bloquear la
  // captura. Para exigirlo, agregar .min(1, 'Indica al menos una razón') aquí
  // y en el alta: `grep -rn "mantenimiento sin razón"`.
  razones: z.array(
    z.string().trim().min(1).max(60, 'Máximo 60 caracteres')
      .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones')
  ).max(10, 'Máximo 10 razones').optional(),
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
