import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { FacturaFolioSchema } from '../schemas/facturaSchema'
import * as service from '../services/facturasService'

/**
 * Corrige el folio mal capturado de una compra.
 *
 * Desde la migración 026 el folio es una columna de la factura, así que
 * corregirlo es un UPDATE de una fila en vez de reescribirlo en todos sus lotes.
 *
 * Si el folio destino ya es de otra factura del mismo proveedor, las dos son el
 * mismo papel capturado en dos tandas: se fusionan moviendo los renglones. Eso
 * requiere `confirmar_fusion` — es legítimo, pero no puede pasar por accidente
 * al corregir una letra.
 */
export async function facturaFolioUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const body = FacturaFolioSchema.parse(await request.json())

    const facturaId = await service.getId(body.num_factura, body.proveedor_id)
    const antes = await capturar('facturas', facturaId)

    const resultado = await service.setFolio(
      facturaId, body.proveedor_id, body.nuevo_num_factura, body.confirmar_fusion,
    )

    await audit({
      user,
      accion: resultado.fusionada ? 'ELIMINAR' : 'EDITAR',
      tabla: 'facturas',
      registroId: facturaId,
      antes,
      // Al fusionar, la factura de origen deja de existir: no hay "después" que
      // capturar y el renglón de la bitácora se queda con lo que era.
      despues: resultado.fusionada ? undefined : await capturar('facturas', facturaId),
      detalles: {
        num_factura: body.num_factura,
        nuevo_num_factura: body.nuevo_num_factura,
        fusionada: resultado.fusionada,
        renglones_movidos: resultado.renglones,
      },
      ipAddress: getClientIp(request),
    })

    return {
      status: 200,
      jsonBody: {
        data: {
          num_factura: body.nuevo_num_factura,
          fusionada: resultado.fusionada,
          lotes_actualizados: resultado.renglones,
        },
      },
    }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('factura-folio-update', {
  methods: ['PUT'],
  route: 'facturas/folio',
  authLevel: 'anonymous',
  handler: facturaFolioUpdate,
})
