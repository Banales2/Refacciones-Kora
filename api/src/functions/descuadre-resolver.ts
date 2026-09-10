import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { nombreOCorreo } from '../shared/usuario'
import * as service from '../services/descuadresService'

// Las dos formas de cerrar un descuadre, y las dos son finales legítimos:
//
//   ajustado -> se contó el estante y se corrigió la existencia.
//   aceptado -> se contó el estante y la pieza sí estaba. No había nada que
//               corregir; el conteo estaba bien desde el principio.
//
// Guardar cuál de las dos fue es lo que permite después saber si esta clase de
// descuadre vale la pena perseguirla.
const Schema = z.object({
  status: z.enum(['ajustado', 'aceptado']),
  // Qué se encontró al contar. Opcional: obligar a escribir algo para cerrar un
  // pendiente de un renglón acaba produciendo notas que dicen "ok".
  nota: z.string().trim().max(500, 'Máximo 500 caracteres').nullish(),
})

export async function descuadreResolver(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const body = Schema.parse(await request.json())
    const cerrado = await service.resolver(
      id, body.status, body.nota || null, await nombreOCorreo(user),
    )

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'descuadres_inventario',
      registroId: id,
      despues: cerrado as unknown as Record<string, unknown>,
      detalles: { status: body.status },
      ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: cerrado } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('descuadre-resolver', {
  methods: ['PUT'],
  route: 'descuadres/{id}',
  authLevel: 'anonymous',
  handler: descuadreResolver,
})
