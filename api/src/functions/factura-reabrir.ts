import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/revisionService'

/**
 * Quita los sellos de una factura para poder corregirla.
 *
 * Existe porque el candado no tiene marcha atrás sin él: una factura revisada no
 * la puede editar nadie, ni un admin, así que un error descubierto después de
 * sellarla quedaría congelado para siempre.
 *
 * NO borra las correcciones ya registradas. Lo que se corrigió la primera vez
 * pasó, y el reporte de errores de captura no puede perderlo porque alguien
 * volviera a abrir la factura — si pudiera, reabrir sería la forma de borrar el
 * rastro de un error.
 */
export async function facturaReabrir(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID de factura inválido' } }

    const antes = await capturar('facturas', id)
    const renglones = await service.reabrir(id)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'facturas',
      registroId: id,
      antes,
      despues: await capturar('facturas', id),
      descripcion: `Reabrió la revisión de la factura (${renglones} renglón(es) vuelven a la bandeja)`,
      detalles: { renglones_reabiertos: renglones },
      ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: { id, renglones_reabiertos: renglones } } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('factura-reabrir', {
  methods: ['POST'],
  route: 'facturas/{id}/reabrir',
  authLevel: 'anonymous',
  handler: facturaReabrir,
})
