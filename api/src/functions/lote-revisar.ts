import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import { RenglonRevisarSchema } from '../schemas/revisionSchema'
import * as service from '../services/revisionService'

/**
 * Verifica un renglón contra la factura original y lo sella.
 *
 * Solo admin: la revisión es el segundo par de ojos, y que la haga cualquiera
 * con permiso de captura la vacía de sentido.
 *
 * Acción con nombre y no un PUT, por lo mismo que `/revisar` de los chequeos
 * (ver `docs/sin-delete.md`): lo que pasa aquí no es "editar un lote", es que
 * alguien se sentó con el papel y se hizo responsable de que cuadre.
 */
export async function loteRevisar(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID de lote inválido' } }

    const body = RenglonRevisarSchema.parse(await request.json())
    const antes = await capturar('lotes_pieza', id)

    const resultado = await service.revisarRenglon(id, body, await nombreOCorreo(user))

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'lotes_pieza',
      registroId: id,
      antes,
      despues: await capturar('lotes_pieza', id),
      descripcion: resultado.correcciones === 0
        ? 'Revisó el renglón contra la factura: coincide'
        : `Revisó el renglón y corrigió ${resultado.correcciones} dato(s)`,
      detalles: {
        factura_id: resultado.factura_id,
        correcciones: resultado.correcciones,
        delta_dinero: resultado.delta_total,
      },
      ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: resultado } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('lote-revisar', {
  methods: ['POST'],
  route: 'lotes/{id}/revisar',
  authLevel: 'anonymous',
  handler: loteRevisar,
})
