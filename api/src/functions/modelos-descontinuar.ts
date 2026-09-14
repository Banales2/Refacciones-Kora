import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/modelosService'

// Descontinuar un modelo sustituye al borrado (migración 032). POST lo
// descontinúa, DELETE lo revive: lo que se crea y se quita aquí es la marca de
// descontinuado, no el modelo, que no se borra nunca.
//
// Ojo con el vocabulario: descontinuar es del MODELO (ya no se compran unidades
// nuevas de él) y no tiene nada que ver con dar de baja una UNIDAD, que es su
// `status` y vive en la tabla hija de su tipo.
const Schema = z.object({
  motivo: z.string().trim().max(200, 'Máximo 200 caracteres').optional(),
})

export async function modelosDescontinuar(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const antes = await capturar('modelos', id)
    const reactivando = req.method === 'DELETE'
    const data = reactivando
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

app.http('modelos-descontinuar', {
  methods: ['POST', 'DELETE'],
  route: 'modelos/{id}/descontinuado',
  authLevel: 'anonymous',
  handler: modelosDescontinuar,
})
