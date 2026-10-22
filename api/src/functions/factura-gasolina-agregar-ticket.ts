import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError, NotFoundError } from '../shared/errors'
import { alcanceDe, exigirVehiculo } from '../shared/alcance'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { AgregarTicketDesdeFacturaSchema } from '../schemas/registroDesdeFacturaSchema'
import * as recargasRepo from '../repositories/recargasRepo'
import * as service from '../services/registroDesdeFacturaService'

/**
 * Agregar, desde un renglón sin casar, el ticket que el chofer no entregó a la
 * recarga que sí reportó: eran dos tanques y solo llegó un ticket. Queda casado
 * con el renglón y marcado para el reporte de omisiones. Ver la migración 077.
 *
 * Solo admin y solo con la factura abierta, como registrar la recarga entera.
 */
export async function facturaGasolinaAgregarTicket(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const facturaId = parseInt(req.params.id, 10)
    const renglonId = parseInt(req.params.renglonId, 10)
    if (isNaN(facturaId) || isNaN(renglonId)) {
      return { status: 400, jsonBody: { error: 'ID inválido' } }
    }

    const data = AgregarTicketDesdeFacturaSchema.parse(await req.json())
    const recarga = await recargasRepo.findById(data.recarga_id)
    if (!recarga) throw new NotFoundError('Recarga')
    await exigirVehiculo(recarga.vehiculo_id, await alcanceDe(user))

    const antes = await capturar('recargas_combustible', data.recarga_id)
    const r = await service.agregarTicket(facturaId, renglonId, data)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'recargas_combustible',
      registroId: r.recarga_id,
      antes,
      despues: await capturar('recargas_combustible', r.recarga_id),
      detalles: {
        desde_factura: facturaId, renglon_id: renglonId, ticket_id: r.ticket_id,
        ticket_agregado: { litros: data.litros, costo: data.costo },
      },
      ipAddress: getClientIp(req),
    })

    return { status: 201, jsonBody: { data: r } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-gasolina-agregar-ticket', {
  methods: ['POST'],
  route: 'facturas-gasolina/{id}/renglones/{renglonId}/agregar-ticket',
  authLevel: 'anonymous',
  handler: facturaGasolinaAgregarTicket,
})
