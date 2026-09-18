import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import { CabeceraRevisarSchema } from '../schemas/revisionSchema'
import * as service from '../services/revisionService'

/**
 * Verifica la cabecera de una factura —folio, fecha, IVA y descuento— contra el
 * papel y la sella.
 *
 * Es la otra mitad del trabajo: esos cuatro datos no viven en ningún renglón, y
 * el IVA y el descuento mueven el total de la compra entera. Una factura está
 * cerrada cuando esto y todos sus renglones están sellados.
 *
 * Solo admin, igual que la revisión del renglón.
 */
export async function facturaCabeceraRevisar(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID de factura inválido' } }

    const body = CabeceraRevisarSchema.parse(await request.json())
    const antes = await capturar('facturas', id)

    const resultado = await service.revisarCabecera(id, body, await nombreOCorreo(user))

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'facturas',
      registroId: id,
      antes,
      // Al fusionar, esta factura dejó de existir: no hay "después" que capturar.
      despues: resultado.fusionada ? undefined : await capturar('facturas', id),
      descripcion: resultado.fusionada
        ? 'Al corregir el folio, la factura se fusionó con otra del mismo proveedor'
        : resultado.correcciones === 0
          ? 'Revisó los datos de la factura: coinciden'
          : `Revisó la factura y corrigió ${resultado.correcciones} dato(s)`,
      detalles: {
        correcciones: resultado.correcciones,
        delta_dinero: resultado.delta_total,
        fusionada: resultado.fusionada,
      },
      ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: resultado } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('factura-cabecera-revisar', {
  methods: ['POST'],
  route: 'facturas/{id}/revisar',
  authLevel: 'anonymous',
  handler: facturaCabeceraRevisar,
})
