// Dar por terminada una póliza (o reactivarla). Archivar, no borrar: la póliza
// se queda como registro de hasta cuándo estuvo cubierta la flota, pero deja de
// pedir una renovación que ya no va a llegar. Ver `segurosService.terminar`.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { SeguroTerminarSchema } from '../schemas/seguroSchema'
import * as service from '../services/segurosService'

export async function segurosTerminar(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const { terminado } = SeguroTerminarSchema.parse(await request.json())
    const antes = await capturar('seguros', id)
    const seguro = await service.terminar(id, terminado)

    // EDITAR y no una acción propia: lo que cambió es una columna de la póliza,
    // y el antes/después ya enseña cuál. `detalles` lo dice en palabras para
    // quien lea la bitácora sin ir a comparar los dos snapshots.
    await audit({
      user,
      accion:     'EDITAR',
      tabla:      'seguros',
      registroId: id,
      antes,
      despues:    await capturar('seguros', id),
      detalles:   { poliza: seguro.poliza, terminada: terminado },
      ipAddress:  getClientIp(request),
    })

    return { status: 200, jsonBody: { data: seguro } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('seguros-terminar', {
  methods: ['POST'],
  route: 'seguros/{id}/terminar',
  authLevel: 'anonymous',
  handler: segurosTerminar,
})
