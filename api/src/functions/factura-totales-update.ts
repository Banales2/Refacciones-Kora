import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { FacturaTotalesSchema } from '../schemas/facturaSchema'
import * as service from '../services/facturasService'

export async function facturaTotalesUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const body = FacturaTotalesSchema.parse(await request.json())

    // El "antes" se captura lote por lote y ANTES de escribir: es lo que permite
    // ver después qué tasa y qué descuento traía cada uno, sobre todo si venían
    // disparejos.
    const ids = await service.getIds(body.num_factura, body.proveedor_id)
    const antes = new Map<number, Awaited<ReturnType<typeof capturar>>>()
    for (const id of ids) antes.set(id, await capturar('lotes_pieza', id))

    await service.setTotales(
      body.num_factura, body.proveedor_id, body.tasa_iva ?? null, body.descuento_pct ?? null,
    )

    for (const id of ids) {
      await audit({
        user,
        accion: 'EDITAR',
        tabla: 'lotes_pieza',
        registroId: id,
        antes: antes.get(id),
        despues: await capturar('lotes_pieza', id),
        detalles: { num_factura: body.num_factura, renglones_factura: ids.length },
        ipAddress: getClientIp(request),
      })
    }

    return { status: 200, jsonBody: { data: { lotes_actualizados: ids.length } } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('factura-totales-update', {
  methods: ['PUT'],
  // Sustituye a 'facturas/iva': ahora fija los dos números de la factura —la
  // tasa y el descuento— en la misma llamada, porque juntos son su total.
  route: 'facturas/totales',
  authLevel: 'anonymous',
  handler: facturaTotalesUpdate,
})
