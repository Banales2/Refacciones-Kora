// Las columnas del programa se editan en bloque: agregar, quitar o reordenar
// una cambia el recorrido completo, y mandarlas de a una dejaría el programa en
// estados intermedios inválidos (una fase única a media vuelta, dos marcas
// desordenadas). El repositorio empata por marca de kilometraje, así que
// reordenar no tira las celdas ya capturadas.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/programaService'
import { FasesSchema } from '../schemas/programaSchema'
import { z } from 'zod'

const Schema = z.object({ fases: FasesSchema })

export async function programaFasesSet(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const { fases } = Schema.parse(await req.json())
    const antes = await capturar('programas_mantenimiento', id)
    const programa = await service.setFases(id, fases)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'programas_mantenimiento',
      registroId: id,
      antes,
      despues: await capturar('programas_mantenimiento', id),
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: programa } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('programa-fases-set', {
  methods: ['PUT'],
  route: 'programa/{id}/fases',
  authLevel: 'anonymous',
  handler: programaFasesSet,
})
