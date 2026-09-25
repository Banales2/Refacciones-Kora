import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe } from '../shared/alcance'
import { audit, getClientIp } from '../shared/audit'
import { nombreOCorreo } from '../shared/usuario'
import { TEXTO_LIBRE, KM_MAX } from '../schemas/common'
import * as service from '../services/vehiculosService'

/**
 * El odómetro de una unidad se puso en cero.
 *
 * No es una corrección de lectura —para eso está el chequeo, que sí deja fijar
 * lo que marque el tablero— sino un hecho que parte la historia en dos: lo que
 * la unidad llevaba deja de contarse en el tablero y pasa a acumularse. Ver la
 * migración 053.
 *
 * Lo registran admin y editor, no el responsable de sucursal: cambia cómo se
 * calcula la vida de la unidad en todos los módulos, y no es una captura de
 * patio.
 */
const Schema = z.object({
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
    .optional(),
  // Lo que marcaba antes de reiniciarse. Ausente = lo que el sistema ya tenía,
  // que es el caso normal.
  km_al_reiniciar: z.coerce.number().int().positive().max(KM_MAX).optional(),
  // Lo que marca ahora. Casi siempre 0, pero entre el reinicio y la captura la
  // unidad pudo rodar unos días.
  km_nuevo: z.coerce.number().int().min(0).max(KM_MAX).optional(),
  motivo: z
    .string().trim().max(200, 'Máximo 200 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
    .nullish(),
})

export async function vehiculoOdometroReinicio(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }

    const data = Schema.parse(await req.json())
    const creado = await service.registrarReinicio(
      id, data, await nombreOCorreo(user), await alcanceDe(user),
    )

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'odometro_reinicios',
      registroId: creado.id,
      detalles: {
        vehiculo_id: id,
        km_al_reiniciar: creado.km_al_reiniciar,
        motivo: creado.motivo,
      },
      ipAddress: getClientIp(req),
    })

    return { status: 201, jsonBody: { data: creado } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculo-odometro-reinicio', {
  methods: ['POST'],
  route: 'vehiculos/{id}/odometro/reinicio',
  authLevel: 'anonymous',
  handler: vehiculoOdometroReinicio,
})

/** Los reinicios que ha tenido una unidad, del más reciente al más viejo. */
export async function vehiculoOdometroReinicios(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'lector', 'responsable')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    return {
      status: 200,
      jsonBody: { data: await service.getReinicios(id, await alcanceDe(user)) },
    }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculo-odometro-reinicios', {
  methods: ['GET'],
  route: 'vehiculos/{id}/odometro/reinicios',
  authLevel: 'anonymous',
  handler: vehiculoOdometroReinicios,
})
