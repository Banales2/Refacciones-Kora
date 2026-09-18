import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import { ConciliarGasolinaSchema } from '../schemas/facturaGasolinaSchema'
import * as service from '../services/facturasGasolinaService'

/**
 * Asigna las recargas que cubre la factura y la sella.
 *
 * Solo admin, igual que la revisión de facturas de refacciones: es el segundo
 * par de ojos sobre lo que se capturó.
 *
 * Lo que sale de aquí y vale la pena mirar es `diferencia`: si es positiva, la
 * gasolinera está cobrando más de lo capturado, y ese hueco son recargas que
 * ocurrieron y nadie registró. Cerrar con diferencia es legítimo —la recarga
 * puede capturarse la semana que viene— pero exige `confirmar_diferencia`, así
 * que no puede pasar por descuido.
 */
export async function facturaGasolinaConciliar(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const body = ConciliarGasolinaSchema.parse(await req.json())
    const antes = await capturar('facturas_gasolina', id)

    const r = await service.conciliar(id, body, await nombreOCorreo(user))

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'facturas_gasolina',
      registroId: id,
      antes,
      despues: await capturar('facturas_gasolina', id),
      descripcion: r.sin_casar === 0
        ? `Concilió la factura: sus ${r.renglones} ticket(s) casaron con una recarga`
        : `Concilió la factura con ${r.sin_casar} ticket(s) sin casar, por ${r.importe_sin_casar.toFixed(2)} sin IVA`,
      detalles: {
        renglones: r.renglones,
        casados: r.casados,
        sin_casar: r.sin_casar,
        importe_sin_casar: r.importe_sin_casar,
        litros_sin_casar: r.litros_sin_casar,
      },
      ipAddress: getClientIp(req),
    })

    return { status: 200, jsonBody: { data: r } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-gasolina-conciliar', {
  methods: ['POST'],
  route: 'facturas-gasolina/{id}/conciliar',
  authLevel: 'anonymous',
  handler: facturaGasolinaConciliar,
})
