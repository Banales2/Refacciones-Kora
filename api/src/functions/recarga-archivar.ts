import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, exigirVehiculo } from '../shared/alcance'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { TEXTO_LIBRE } from '../schemas/common'
import * as service from '../services/recargasService'

/**
 * Archivar una recarga que se capturó de más, y deshacerlo (migración 081).
 *
 * No es borrar: la recarga se queda con su vale y sus tickets, deja de contar
 * en todo y se puede restaurar. Dos POST y no un DELETE, como todo lo demás:
 * ver docs/sin-delete.md.
 *
 * Admin y editor, los que firman el gasto: archivar una recarga saca dinero
 * de los costos. El motivo es obligatorio por lo mismo; quién lo hizo queda en
 * la bitácora.
 */
const Schema = z.object({
  motivo: z
    .string().trim()
    .min(3, 'Escribe por qué se archiva')
    .max(200, 'Máximo 200 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos'),
})

function handler(accion: 'archivar' | 'restaurar') {
  return async function recargaArchivar(
    req: HttpRequest, ctx: InvocationContext,
  ): Promise<HttpResponseInit> {
    try {
      const user = requireRole(req, 'admin', 'editor')
      const id = parseInt(req.params.id, 10)
      if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
      const recarga = await service.getById(id)
      // Quien está acotado a una sucursal solo archiva las de sus unidades.
      await exigirVehiculo(recarga.vehiculo_id, await alcanceDe(user))
      const esAdmin = user.userRoles.includes('admin')

      const antes = await capturar('recargas_combustible', id)
      if (accion === 'archivar') {
        const { motivo } = Schema.parse(await req.json().catch(() => ({})))
        await service.archivar(id, motivo, esAdmin)
      } else {
        await service.restaurar(id, esAdmin)
      }

      await audit({
        user,
        accion: 'EDITAR',
        tabla: 'recargas_combustible',
        registroId: id,
        antes,
        despues: await capturar('recargas_combustible', id),
        detalles: { accion },
        ipAddress: getClientIp(req),
      })

      return { status: 200, jsonBody: { data: await service.getById(id) } }
    } catch (err) {
      return handleError(err, ctx)
    }
  }
}

app.http('recarga-archivar', {
  methods: ['POST'],
  route: 'recargas/{id}/archivar',
  authLevel: 'anonymous',
  handler: handler('archivar'),
})

app.http('recarga-restaurar', {
  methods: ['POST'],
  route: 'recargas/{id}/restaurar',
  authLevel: 'anonymous',
  handler: handler('restaurar'),
})
