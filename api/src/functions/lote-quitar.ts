import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/revisionService'

/**
 * Quita el renglón que se capturó de más y no está en la factura original.
 *
 * Es lo que hace falta cuando el verificador encuentra en la pantalla una pieza
 * que el papel no trae. Borra de verdad, y está bien que lo haga: no es
 * historia, es un renglón que nunca debió existir. `docs/sin-delete.md` distingue
 * justamente eso — las entidades se archivan, lo capturado por error se quita.
 *
 * ANTES COMPRUEBA QUE DE VERDAD NUNCA EXISTIÓ. Si sus piezas ya se montaron, se
 * consumieron, se traspasaron o se les dio unidad, entonces sí entraron al
 * almacén y lo que sobra no es el renglón sino la explicación de dónde salieron.
 * El service devuelve un 409 que nombra qué lo está deteniendo.
 *
 * EL CASO PARECIDO QUE NO ES ESTE: que el renglón sí se haya comprado pero
 * pertenezca a otra factura. Eso se mueve con `PUT /lotes/{id}` poniéndole el
 * folio correcto, no se borra — y el mensaje de error lo recuerda, porque es el
 * error que más caro sale confundir.
 *
 * Solo admin, y solo mientras el renglón no esté sellado.
 */
export async function loteQuitar(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID de lote inválido' } }

    // El snapshot es el único rastro que va a quedar de la fila.
    const antes = await capturar('lotes_pieza', id)
    const resultado = await service.quitarRenglon(id)

    await audit({
      user,
      accion: 'ELIMINAR',
      tabla: 'lotes_pieza',
      registroId: id,
      antes,
      descripcion: 'Quitó el renglón: no aparece en la factura original',
      detalles: {
        factura_id: resultado.factura_id,
        factura_borrada: resultado.factura_borrada,
      },
      ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: resultado } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('lote-quitar', {
  methods: ['POST'],
  route: 'lotes/{id}/quitar',
  authLevel: 'anonymous',
  handler: loteQuitar,
})
