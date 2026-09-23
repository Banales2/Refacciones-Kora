import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { FacturaQuerySchema } from '../schemas/facturaSchema'
import * as tecnicosRepo from '../repositories/tecnicosRepo'
import * as facturasService from '../services/facturasService'

/**
 * Las facturas de un taller.
 *
 * RECIBE UN TALLER Y RESUELVE EL PROVEEDOR POR DENTRO. Podría no existir y la
 * pantalla podría llamar a `/facturas?proveedor_id=…`, pero entonces el catálogo
 * de técnicos tendría que saber que un taller factura como proveedor, y esa es
 * justo la consecuencia del modelo que no tiene por qué salir a la superficie.
 * Aquí entra un `tecnico_id` y salen sus facturas.
 *
 * SIN VÍNCULO NO HAY FACTURAS, y se contesta con una lista vacía en vez de un
 * 404: el taller existe, simplemente no ha facturado nada todavía. Se usa
 * `proveedorVinculado` y no `proveedorDeTaller` porque aquella CREA el proveedor
 * si falta, y abrir una lista para mirarla no puede dar de alta nada.
 *
 * Devuelve las facturas COMPLETAS —refacciones y mano de obra—, no solo las de
 * taller. Si a ese mismo taller se le compraron refacciones, esas facturas son
 * suyas igual, y separarlas aquí escondería justo el papel mixto.
 */
export async function tecnicoFacturas(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const proveedorId = await tecnicosRepo.proveedorVinculado(id)
    if (proveedorId === null) {
      const params = FacturaQuerySchema.parse({
        page: req.query.get('page') ?? undefined,
        pageSize: req.query.get('pageSize') ?? undefined,
      })
      return {
        status: 200,
        jsonBody: {
          data: [],
          pagination: { page: params.page, pageSize: params.pageSize, total: 0 },
        },
      }
    }

    const params = FacturaQuerySchema.parse({
      page: req.query.get('page') ?? undefined,
      pageSize: req.query.get('pageSize') ?? undefined,
      search: req.query.get('search') ?? undefined,
      desde: req.query.get('desde') ?? undefined,
      hasta: req.query.get('hasta') ?? undefined,
      por_revisar: req.query.get('por_revisar') ?? undefined,
      con_mano_obra: req.query.get('con_mano_obra') ?? undefined,
      proveedor_id: proveedorId,
    })

    const r = await facturasService.getAll(params)
    return {
      status: 200,
      jsonBody: {
        data: r.data,
        pagination: { page: r.page, pageSize: r.pageSize, total: r.total },
      },
    }
  } catch (err) { return handleError(err, ctx) }
}

app.http('tecnico-facturas', {
  methods: ['GET'],
  route: 'tecnicos/{id}/facturas',
  authLevel: 'anonymous',
  handler: tecnicoFacturas,
})
