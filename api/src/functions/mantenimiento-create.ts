import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import {
  TEXTO_LIBRE, KM_MAX, lecturaKm, MANTENIMIENTO_BASICO, TIPOS_MANTENIMIENTO,
} from '../schemas/common'
import * as service from '../services/mantenimientoService'

const Schema = z.object({
  fecha:             z.string().date(),
  tipo:              z.enum(TIPOS_MANTENIMIENTO),
  // Obligatorio salvo en el básico, que no pasa por taller. Lo exige el
  // `superRefine` de abajo, que es donde se sabe el tipo.
  tecnico_id:        z.coerce.number().int().positive('Técnico requerido').nullish(),
  costo:             z.coerce.number({ error: 'Costo requerido' }).min(0),
  km_actual:         lecturaKm(),
  observaciones:     z.string().trim().min(1, 'Observaciones requeridas').max(255, 'Máximo 255 caracteres')
                       .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos'),
  // TEMPORAL — mantenimiento sin origen. El vínculo era obligatorio (.min(1)) y
  // volverá a serlo: se suspendió para poder capturar mantenimientos antiguos
  // cuya razón ya no se conserva. Para reactivarlo, devolver el .min(1) aquí y
  // en los demás puntos marcados: `grep -rn "mantenimiento sin origen"`.
  //
  // Ojo al reactivarlo: la visita de un servicio del programa NO viaja por aquí
  // —su origen se guarda al cerrar la columna, en `mantenimiento_programa`—, así
  // que exigir el vínculo sin más dejaría de poder registrarse. La condición es
  // "tiene pendientes O cierra una columna del programa".
  pendiente_ids: z.array(z.number().int().positive()),
})
  .superRefine((v, ctx) => {
    if (v.tipo !== MANTENIMIENTO_BASICO && !v.tecnico_id) {
      ctx.addIssue({ code: 'custom', path: ['tecnico_id'], message: 'Técnico requerido' })
    }
  })
  // El básico no lleva técnico ni cuesta, diga lo que diga el cuerpo: así nunca
  // aparece como mano de obra por facturar.
  .transform((v) => v.tipo === MANTENIMIENTO_BASICO ? { ...v, tecnico_id: null, costo: 0 } : v)

export async function mantenimientoCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const body = Schema.parse(await req.json())
    const created = await service.create(vehiculoId, body, await nombreOCorreo(user))
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
