import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as repo from '../repositories/unidadesPiezaRepo'

/**
 * Le da identidad al stock que ya estaba en el estante cuando se encendió el
 * rastreo de su tipo.
 *
 * Encender el flag no hace aparecer unidades para lo que ya se había comprado:
 * esas piezas existen en la existencia pero no se pueden identificar. Esto crea
 * las que faltan, sin etiqueta —nadie sabe cuál es cuál hasta ir al estante—,
 * para que después se rotulen una por una.
 *
 * Es idempotente: si ya cuadran, no crea nada y devuelve 0.
 */
export async function piezaUnidadesGenerar(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const creadas = await repo.generarFaltantes(id)

    if (creadas > 0) {
      await audit({
        user,
        accion: 'CREAR',
        tabla: 'unidades_pieza',
        registroId: id,
        detalles: { pieza_id: id, unidades_creadas: creadas, origen: 'stock_existente' },
        ipAddress: getClientIp(request),
      })
    }

    return { status: 200, jsonBody: { data: { creadas } } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('pieza-unidades-generar', {
  methods: ['POST'],
  route: 'piezas/{id}/unidades/generar',
  authLevel: 'anonymous',
  handler: piezaUnidadesGenerar,
})
