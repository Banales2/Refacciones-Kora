import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/plantillaService'
import { TEXTO_SIMPLE, TEXTO_LIBRE, KM_MAX } from '../schemas/common'
import { GarantiaIdsSchema } from '../schemas/garantiaSchema'
import { IntervalosInicialesSchema } from '../schemas/intervalosSchema'

const Schema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(40, 'Máximo 40 caracteres')
    .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones')
    .optional(),
  descripcion: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(255, 'Máximo 255 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
    .optional(),
  categoria: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .max(30, 'Máximo 30 caracteres')
    .regex(TEXTO_SIMPLE, 'Solo letras, números, espacios y guiones')
    .optional(),
  trigger_mode:    z.enum(['km', 'meses', 'ambos']).optional(),
  intervalo_km:    z.coerce.number().int().positive().max(KM_MAX, 'Máximo 9,999,999 km').nullable().optional(),
  intervalo_meses: z.coerce.number().int().positive().nullable().optional(),
  // Primeros servicios con intervalo propio, antes de caer en el de ciclo.
  intervalos_iniciales_km: IntervalosInicialesSchema,
  activo:          z.boolean().optional(),
  // Garantías del modelo que obligan a este servicio. Ausente = no se tocan.
  garantia_modelo_ids: GarantiaIdsSchema,
})

export async function plantillaUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const { garantia_modelo_ids, ...body } = Schema.parse(await req.json())
    const antes = await capturar('plantilla_requerimientos_modelo', id)
    const updated = await service.update(id, body, garantia_modelo_ids)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'plantilla_requerimientos_modelo',
      registroId: id,
      antes,
      despues: await capturar('plantilla_requerimientos_modelo', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: updated } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('plantilla-update', {
  methods: ['PUT', 'PATCH'],
  route: 'plantilla/{id}',
  authLevel: 'anonymous',
  handler: plantillaUpdate,
})
