import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, exigirVehiculo } from '../shared/alcance'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { RegistrarDesdeFacturaSchema } from '../schemas/registroDesdeFacturaSchema'
import * as service from '../services/registroDesdeFacturaService'

/**
 * Registrar, desde un renglón sin casar, la recarga que el chofer no reportó
 * —y el vale, si el encargado tampoco lo registró—. Queda casada con el
 * renglón y marcada para el reporte de omisiones. Ver la migración 069.
 *
 * Solo admin, como conciliar: es quien está cuadrando la factura. Y solo en
 * una factura abierta: la sellada se reabre primero.
 */
export async function facturaGasolinaRegistrarRecarga(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const facturaId = parseInt(req.params.id, 10)
    const renglonId = parseInt(req.params.renglonId, 10)
    if (isNaN(facturaId) || isNaN(renglonId)) {
      return { status: 400, jsonBody: { error: 'ID inválido' } }
    }

    const data = RegistrarDesdeFacturaSchema.parse(await req.json())
    const alcance = await alcanceDe(user)
    await exigirVehiculo(data.vehiculo_id, alcance)

    const r = await service.registrar(facturaId, renglonId, data, user.userDetails, alcance.sucursalId)

    const ip = getClientIp(req)
    if (r.vale_nuevo) {
      await audit({
        user,
        accion: 'CREAR',
        tabla: 'vales_gasolina',
        registroId: r.vale_id,
        despues: await capturar('vales_gasolina', r.vale_id),
        detalles: { desde_factura: facturaId, renglon_id: renglonId },
        ipAddress: ip,
      })
    }
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'recargas_combustible',
      registroId: r.recarga_id,
      despues: await capturar('recargas_combustible', r.recarga_id),
      detalles: {
        desde_factura: facturaId, renglon_id: renglonId, ticket_id: r.ticket_id,
        vale_nuevo: r.vale_nuevo,
      },
      ipAddress: ip,
    })

    return { status: 201, jsonBody: { data: r } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-gasolina-registrar-recarga', {
  methods: ['POST'],
  route: 'facturas-gasolina/{id}/renglones/{renglonId}/registrar',
  authLevel: 'anonymous',
  handler: facturaGasolinaRegistrarRecarga,
})
