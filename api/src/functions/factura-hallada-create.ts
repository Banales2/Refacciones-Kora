import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import { FacturaHalladaSchema } from '../schemas/cuadreSchema'
import * as service from '../services/cuadreFacturaService'

/**
 * Da de alta la factura que nadie había capturado, encontrada al revisar.
 *
 * Es el hueco que ni la 040 ni la 044 podían cerrar: aquellas cazan lo que falta
 * DENTRO de una factura conocida, y una factura que nunca se capturó no existe
 * como fila — no sale en el listado, no entra a la bandeja y no tiene cuadre que
 * abrir. No hay forma de detectarla sola; el único detector es la persona con el
 * fajo de papeles, y esto es donde lo registra.
 *
 * Nace sin renglones: al abrir su cuadre, todo lo que se transcriba del papel
 * sale como "falta capturar", que es la verdad.
 *
 * Solo admin.
 */
export async function facturaHalladaCreate(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const body = FacturaHalladaSchema.parse(await req.json())

    const id = await service.crearHallada(body, await nombreOCorreo(user))

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'facturas',
      registroId: id,
      despues: await capturar('facturas', id),
      descripcion: 'Dio de alta una factura que nadie había capturado, encontrada al revisar',
      ipAddress: getClientIp(req),
    })

    return { status: 201, jsonBody: { data: { id } } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-hallada-create', {
  methods: ['POST'],
  route: 'facturas/halladas',
  authLevel: 'anonymous',
  handler: facturaHalladaCreate,
})
