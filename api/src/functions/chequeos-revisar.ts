import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import * as service from '../services/chequeosService'
import { ChequeoRevisarSchema } from '../schemas/chequeoSchema'

// Leer el reporte del chofer y decidir qué hacer con él: abrir la incidencia o
// cerrarlo con una nota. Acción con nombre y no un PUT genérico, por lo mismo
// que `/archivar` o `/atender` (ver `docs/sin-delete.md`): lo que pasa aquí no
// es "editar un chequeo", es que alguien se hizo cargo.
export async function chequeosRevisar(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = ChequeoRevisarSchema.parse(await req.json())

    const antes = await capturar('chequeos', id)
    const chequeo = await service.revisar(id, body, await nombreOCorreo(user))

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'chequeos',
      registroId: id,
      antes,
      despues: await capturar('chequeos', id),
      descripcion: body.abrir_incidencia
        ? 'Revisó el reporte del chofer y abrió incidencia'
        : 'Revisó el reporte del chofer',
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: chequeo } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('chequeos-revisar', {
  methods: ['POST'],
  route: 'chequeos/{id}/revisar',
  authLevel: 'anonymous',
  handler: chequeosRevisar,
})
