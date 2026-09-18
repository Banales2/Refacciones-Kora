import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/facturasGasolinaService'

/**
 * Suelta la factura para volver a cuadrarla.
 *
 * Es lo que hace falta cuando aparece la recarga que faltaba: se captura por la
 * vía normal, se reabre la factura y ahora sí cuadra. Sin esto, una factura
 * cerrada con hueco se quedaría con el hueco para siempre aunque el hueco ya no
 * exista.
 *
 * Las recargas que tenía asignadas NO se sueltan: siguen ahí para que al reabrir
 * se vea lo que se había elegido y solo haya que ajustar.
 */
export async function facturaGasolinaReabrir(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const antes = await capturar('facturas_gasolina', id)
    await service.reabrir(id)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'facturas_gasolina',
      registroId: id,
      antes,
      despues: await capturar('facturas_gasolina', id),
      descripcion: 'Reabrió la conciliación de la factura',
      ipAddress: getClientIp(req),
    })

    return { status: 200, jsonBody: { data: { id } } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-gasolina-reabrir', {
  methods: ['POST'],
  route: 'facturas-gasolina/{id}/reabrir',
  authLevel: 'anonymous',
  handler: facturaGasolinaReabrir,
})
