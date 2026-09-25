import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { TEXTO_LIBRE } from '../schemas/common'
import * as service from '../services/valesGasolinaService'

/**
 * Dar un vale por perdido, y deshacerlo si aparece.
 *
 * El mecanismo es el mismo que archivar un catálogo (migración 033) y usa el
 * mismo repositorio, pero no la misma puerta: archivar una sucursal es de
 * admin porque cambia el catálogo de toda la empresa; dar por perdido un papel
 * de gasolina es trabajo de todos los días de quien lleva los vales.
 *
 * Son dos rutas POST y no un DELETE por lo de siempre: la API no expone ese
 * verbo en ninguna parte para poder bloquearlo entero en el borde. Ver
 * docs/sin-delete.md.
 */
const Schema = z.object({
  motivo: z
    .string().trim().max(200, 'Máximo 200 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
    .optional(),
})

function handler(accion: 'archivar' | 'restaurar') {
  return async function valeArchivar(
    req: HttpRequest, ctx: InvocationContext,
  ): Promise<HttpResponseInit> {
    try {
      const user = requireRole(req, 'admin', 'editor')
      const id = parseInt(req.params.id, 10)
      if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

      const antes = await capturar('vales_gasolina', id)
      if (accion === 'restaurar') {
        await service.restaurar(id)
      } else {
        const { motivo } = Schema.parse(await req.json().catch(() => ({})))
        await service.archivar(id, motivo ?? null)
      }

      await audit({
        user,
        accion: 'EDITAR',
        tabla: 'vales_gasolina',
        registroId: id,
        antes,
        despues: await capturar('vales_gasolina', id),
        detalles: { accion },
        ipAddress: getClientIp(req),
      })

      return { status: 204 }
    } catch (err) { return handleError(err, ctx) }
  }
}

app.http('vale-gasolina-archivar', {
  methods: ['POST'],
  route: 'vales-gasolina/{id}/archivar',
  authLevel: 'anonymous',
  handler: handler('archivar'),
})

app.http('vale-gasolina-restaurar', {
  methods: ['POST'],
  route: 'vales-gasolina/{id}/restaurar',
  authLevel: 'anonymous',
  handler: handler('restaurar'),
})
