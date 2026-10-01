import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { assertManoObraEditable } from '../shared/revision'
import {
  TEXTO_LIBRE, KM_MAX, lecturaKm, MANTENIMIENTO_BASICO, TIPOS_MANTENIMIENTO,
} from '../schemas/common'
import * as service from '../services/mantenimientoService'

const Schema = z.object({
  fecha:             z.string().date().optional(),
  tipo:              z.enum(TIPOS_MANTENIMIENTO).optional(),
  tecnico_id:        z.coerce.number().int().positive('Técnico requerido').nullish(),
  costo:             z.coerce.number().min(0).optional(),
  km_actual:         lecturaKm().optional(),
  observaciones:     z.string().trim().min(1, 'Observaciones requeridas').max(255, 'Máximo 255 caracteres')
                       .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos').optional(),
  // TEMPORAL — mantenimiento sin origen. Igual que en el alta: el .min(1) se
  // suspendió para los mantenimientos antiguos y volverá a ponerse, y con la
  // misma salvedad de la visita del programa.
  pendiente_ids: z.array(z.number().int().positive()).optional(),
})
  // Volverlo básico le quita técnico y costo, igual que en el alta.
  .transform((v) => v.tipo === MANTENIMIENTO_BASICO ? { ...v, tecnico_id: null, costo: 0 } : v)

export async function mantenimientoUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = Schema.parse(await req.json())

    // Solo el costo choca con el sello: es lo único de este registro que sale de
    // la factura del taller. La fecha, el kilometraje y las observaciones no las
    // da por buenas ningún papel y se siguen corrigiendo aunque la mano de obra
    // ya esté cuadrada. Ver `shared/revision.assertManoObraEditable`.
    if (body.costo !== undefined) await assertManoObraEditable(id)

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
