// Todo lo que se le ha comprado a un proveedor: los lotes que entraron con su
// nombre, que es el gasto que de verdad salió de la caja. No confundir con
// `precios_proveedor`, que es lo que pide aunque no se le compre.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as repo from '../repositories/lotesRepo'

export async function proveedoresGastos(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    return { status: 200, jsonBody: { data: await repo.findGastosDeProveedor(id) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('proveedores-gastos', {
  methods: ['GET'],
  route: 'proveedores/{id}/gastos',
  authLevel: 'anonymous',
  handler: proveedoresGastos,
})
