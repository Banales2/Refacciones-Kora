import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import { FacturaGasolinaCreateSchema } from '../schemas/facturaGasolinaSchema'
import * as service from '../services/facturasGasolinaService'

/**
 * Registra la factura de una gasolinera: gasolinera, folio, fecha y total.
 *
 * Solo eso. El papel no trae con qué apuntar a una recarga concreta —ni
 * vehículo, ni chofer, ni folio de vale—, así que qué cargas cubre se decide
 * después, conciliando. Ver `POST /facturas-gasolina/{id}/conciliar`.
 */
export async function facturaGasolinaCreate(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'responsable')
    const body = FacturaGasolinaCreateSchema.parse(await req.json())

    // Quien la registra sale de la sesión, no del cuerpo: mismo criterio que en
    // las compras de refacciones, para que no pueda quedar a nombre de otro.
    const id = await service.crear(body, await nombreOCorreo(user))

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'facturas_gasolina',
      registroId: id,
      despues: await capturar('facturas_gasolina', id),
      ipAddress: getClientIp(req),
    })

    return { status: 201, jsonBody: { data: { id } } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-gasolina-create', {
  methods: ['POST'],
  route: 'facturas-gasolina',
  authLevel: 'anonymous',
  handler: facturaGasolinaCreate,
})
