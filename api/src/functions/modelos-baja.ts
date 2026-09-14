import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/modelosService'

// La baja de un modelo sustituye al borrado (migración 032). POST la da, DELETE
// la deshace: lo que se está creando y quitando aquí es la baja, no el modelo,
// que no se borra nunca.
const Schema = z.object({
  motivo: z.string().trim().max(200, 'Máximo 200 caracteres').optional(),
})

export async function modelosBaja(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const antes = await capturar('modelos', id)
    const reactivando = req.method === 'DELETE'
    const data = reactivando
      ? await service.reactivar(id)
      : await service.darDeBaja(id, Schema.parse(await req.json().catch(() => ({}))).motivo)

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

app.http('modelos-baja', {
  methods: ['POST', 'DELETE'],
  route: 'modelos/{id}/baja',
  authLevel: 'anonymous',
  handler: modelosBaja,
})
