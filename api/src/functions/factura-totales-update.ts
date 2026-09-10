import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { FacturaTotalesSchema } from '../schemas/facturaSchema'
import * as service from '../services/facturasService'

/**
 * Fija el IVA y el descuento de una compra.
 *
 * Desde la migración 026 es un UPDATE de una fila: la cabecera vive en
 * `facturas`. Antes había que escribirlo en los N lotes, y eso es lo que dejaba
 * facturas con la tasa dispareja entre sus renglones.
 */
export async function facturaTotalesUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const body = FacturaTotalesSchema.parse(await request.json())

    const facturaId = await service.getId(body.num_factura, body.proveedor_id)
    const antes = await capturar('facturas', facturaId)

    await service.setTotales(facturaId, body.tasa_iva ?? null, body.descuento_pct ?? null)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'facturas',
      registroId: facturaId,
      antes,
      despues: await capturar('facturas', facturaId),
      detalles: { num_factura: body.num_factura },
      ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: { id: facturaId } } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('factura-totales-update', {
  methods: ['PUT'],
  route: 'facturas/totales',
  authLevel: 'anonymous',
  handler: facturaTotalesUpdate,
})
