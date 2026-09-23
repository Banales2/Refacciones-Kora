// Qué se le hace a una pieza a lo largo de todas las fases: el renglón entero
// de la cuadrícula. Llega completo porque así se edita —marcando y desmarcando
// celdas—, y lo que no viene queda en blanco, que es el "-" del manual.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/programaService'
import { CeldasSchema } from '../schemas/programaSchema'

export async function programaCeldasSet(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const { celdas } = CeldasSchema.parse(await req.json())
    const antes = await capturar('programa_operaciones', id)
    const programa = await service.setCeldas(id, celdas)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'programa_operaciones',
      registroId: id,
      antes,
      despues: await capturar('programa_operaciones', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: programa } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('programa-celdas-set', {
  methods: ['PUT'],
  route: 'programa-operaciones/{id}/celdas',
  authLevel: 'anonymous',
  handler: programaCeldasSet,
})
