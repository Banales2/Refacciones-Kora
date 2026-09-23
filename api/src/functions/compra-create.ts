import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { CompraCreateSchema } from '../schemas/compraSchema'
import { nombreOCorreo } from '../shared/usuario'
import * as service from '../services/comprasService'

export async function compraCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const body = CompraCreateSchema.parse(await request.json())
    // Quien registra la compra es quien la autoriza: sale de la sesión, no del
    // cuerpo, igual que en el alta de un lote suelto.
    const creada = await service.crearCompra(body, await nombreOCorreo(user))

    // La bitácora se lleva por registro, no por factura: no hay tabla `compras`
    // y una entrada suelta que dijera "factura A-123" no dejaría rastro de cada
    // lote. `num_factura` en los detalles es lo que vuelve a juntarlos.
    for (const lote of creada.lotes) {
      if (lote.pieza_nueva) {
        await audit({
          user,
          accion: 'CREAR',
          tabla: 'piezas',
          registroId: lote.pieza_id,
          despues: await capturar('piezas', lote.pieza_id),
          detalles: { num_factura: creada.num_factura },
          ipAddress: getClientIp(request),
        })
      }
      await audit({
        user,
        accion: 'CREAR',
        tabla: 'lotes_pieza',
        registroId: lote.id,
        despues: await capturar('lotes_pieza', lote.id),
        detalles: {
          pieza_id: lote.pieza_id,
          cantidad_inicial: lote.cantidad_disponible,
          num_factura: creada.num_factura,
          renglones_factura: creada.lotes.length,
        },
        ipAddress: getClientIp(request),
      })
    }

    return { status: 201, jsonBody: { data: creada } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('compra-create', {
  methods: ['POST'],
  route: 'compras',
  authLevel: 'anonymous',
  handler: compraCreate,
})
