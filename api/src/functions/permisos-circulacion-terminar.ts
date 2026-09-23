// Dar por terminado un permiso de circulación (o revivirlo). Archivar, no
// borrar: el permiso se queda como registro de hasta cuándo la unidad estuvo en
// regla, pero deja de pedir una renovación que ya no va a llegar. Espejo exacto
// de `seguros-terminar`. Ver `permisosCirculacionService.terminar`.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/permisosCirculacionService'

const Schema = z.object({ terminado: z.boolean().default(true) })

export async function permisosCirculacionTerminar(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const { terminado } = Schema.parse(await request.json())
    const antes = await capturar('permisos_circulacion', id)
    const permiso = await service.terminar(id, terminado)

    await audit({
      user,
      accion:     'EDITAR',
      tabla:      'permisos_circulacion',
      registroId: id,
      antes,
      despues:    await capturar('permisos_circulacion', id),
      detalles:   { zona: permiso.zona_circulacion, terminado },
      ipAddress:  getClientIp(request),
    })

    return { status: 200, jsonBody: { data: permiso } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('permisos-circulacion-terminar', {
  methods: ['POST'],
  route: 'permisos-circulacion/{id}/terminar',
  authLevel: 'anonymous',
  handler: permisosCirculacionTerminar,
})
