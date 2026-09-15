import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/modelosService'

// Descontinuar un modelo sustituye al borrado (migración 032). Dos acciones,
// las dos POST: `/descontinuar` y `/revivir`. Lo que se pone y se quita aquí es
// la marca de descontinuado, no el modelo, que no se borra nunca.
//
// Son dos rutas y no una con dos verbos porque la API no expone DELETE en
// ninguna parte, para poder bloquear el verbo entero en el borde. Ver
// docs/sin-delete.md.
//
// Ojo con el vocabulario: descontinuar es del MODELO (ya no se compran unidades
// nuevas de él) y no tiene nada que ver con dar de baja una UNIDAD, que es su
// `status` y vive en la tabla hija de su tipo.
const Schema = z.object({
  motivo: z.string().trim().max(200, 'Máximo 200 caracteres').optional(),
})

function handler(accion: 'descontinuar' | 'revivir') {
  return async function modelosDescontinuar(
    req: HttpRequest, ctx: InvocationContext,
  ): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const antes = await capturar('modelos', id)
    const data = accion === 'revivir'
      ? await service.reactivar(id)
      : await service.descontinuar(id, Schema.parse(await req.json().catch(() => ({}))).motivo)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'modelos',
      registroId: id,
      antes,
      despues: await capturar('modelos', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
  }
}

for (const accion of ['descontinuar', 'revivir'] as const) {
  app.http(`modelos-${accion}`, {
    methods: ['POST'],
    route: `modelos/{id}/${accion}`,
    authLevel: 'anonymous',
    handler: handler(accion),
  })
}
