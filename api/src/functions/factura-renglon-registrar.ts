import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import { RegistrarRenglonSchema } from '../schemas/cuadreSchema'
import * as service from '../services/cuadreFacturaService'

/**
 * Registra la compra que el papel cobra y nadie había capturado.
 *
 * Es el otro lado de `POST /lotes/{id}/quitar`: aquel borra lo que sobra, este
 * da de alta lo que falta. El renglón del papel ya sabe qué refacción, cuántas y
 * a qué costo; lo único que el papel no dice es dónde entró la mercancía, y por
 * eso lo único que se pide es la sucursal.
 *
 * Solo admin.
 */
export async function facturaRenglonRegistrar(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID de renglón inválido' } }

    const body = RegistrarRenglonSchema.parse(await req.json())
    const r = await service.registrarRenglon(
      id, body.sucursal_id, await nombreOCorreo(user),
    )

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'lotes_pieza',
      registroId: r.lote_id,
      despues: await capturar('lotes_pieza', r.lote_id),
      descripcion: 'Registró la compra que faltaba, encontrada al cuadrar la factura',
      detalles: { factura_id: r.factura_id, renglon_papel_id: id },
      ipAddress: getClientIp(req),
    })

    return { status: 201, jsonBody: { data: r } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-renglon-registrar', {
  methods: ['POST'],
  route: 'facturas/renglones/{id}/registrar',
  authLevel: 'anonymous',
  handler: facturaRenglonRegistrar,
})
