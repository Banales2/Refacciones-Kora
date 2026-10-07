import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { IvaFacturaSchema } from '../schemas/facturaGasolinaSchema'
import * as service from '../services/facturasGasolinaService'

/**
 * Le pone a una factura el IVA que dice su papel.
 *
 * Es para las capturadas antes de la migración 065, cuyo total salía de
 * subtotal * 1.16 y daba de más: en combustible el IVA no se cobra sobre el
 * IEPS. Con el IVA del papel, el total pasa a ser subtotal + IVA.
 */
export async function facturaGasolinaIva(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const body = IvaFacturaSchema.parse(await req.json())

    const antes = await capturar('facturas_gasolina', id)
    await service.corregirIva(id, body.iva)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'facturas_gasolina',
      registroId: id,
      antes,
      despues: await capturar('facturas_gasolina', id),
      descripcion: 'Capturó el IVA del papel de la factura',
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: { id } } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-gasolina-iva', {
  methods: ['PUT'],
  route: 'facturas-gasolina/{id}/iva',
  authLevel: 'anonymous',
  handler: facturaGasolinaIva,
})
