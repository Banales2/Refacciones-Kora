import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { FacturaFolioSchema } from '../schemas/facturaSchema'
import * as service from '../services/facturasService'

/**
 * Corrige el folio mal capturado de una compra, en todos sus lotes de una vez.
 * La factura no es una tabla —es el folio que comparten sus lotes—, así que
 * renombrarla es un UPDATE sobre todos ellos; cambiar solo unos cuantos la
 * partiría en dos compras.
 */
export async function facturaFolioUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const body = FacturaFolioSchema.parse(await request.json())

    // El "antes" se captura lote por lote y ANTES de escribir: es lo que deja
    // ver después con qué folio había entrado cada uno.
    const ids = await service.getIds(body.num_factura, body.proveedor_id)
    const antes = new Map<number, Awaited<ReturnType<typeof capturar>>>()
    for (const id of ids) antes.set(id, await capturar('lotes_pieza', id))

    await service.setFolio(body.num_factura, body.proveedor_id, body.nuevo_num_factura)

    for (const id of ids) {
      await audit({
        user,
        accion: 'EDITAR',
        tabla: 'lotes_pieza',
        registroId: id,
        antes: antes.get(id),
        despues: await capturar('lotes_pieza', id),
        detalles: {
          num_factura: body.num_factura,
          nuevo_num_factura: body.nuevo_num_factura,
          renglones_factura: ids.length,
        },
        ipAddress: getClientIp(request),
      })
    }

    return {
      status: 200,
      jsonBody: { data: { num_factura: body.nuevo_num_factura, lotes_actualizados: ids.length } },
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
