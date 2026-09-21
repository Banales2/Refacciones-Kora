import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import { FacturaTallerSchema } from '../schemas/manoObraSchema'
import * as service from '../services/manoObraService'

/**
 * Da de alta la factura de un taller.
 *
 * Recibe un TALLER, no un proveedor. Que por debajo la factura cuelgue de un
 * proveedor es una consecuencia del modelo —su llave es (proveedor, folio), y
 * tiene que serlo porque el mismo papel puede cobrar refacciones— y no algo que
 * quien captura tenga que saber. El proveedor del taller se resuelve solo, y se
 * crea la primera vez que ese taller factura.
 *
 * Si ese taller ya tiene ese folio, devuelve la factura que ya existía en vez de
 * fallar: el caso normal de un papel mixto es que sus refacciones ya se hayan
 * capturado como compra, y entonces lo que falta es colgarle la mano de obra, no
 * abrir un segundo documento. `ya_existia` es lo que la pantalla usa para decir
 * "esta factura ya estaba, ábrele el cuadre" en vez de anunciar un alta que no
 * ocurrió.
 *
 * Solo admin, igual que el resto del cuadre.
 */
export async function facturaTallerCreate(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const body = FacturaTallerSchema.parse(await req.json())

    const { id, ya_existia } = await service.crearDeTaller(body, await nombreOCorreo(user))

    if (!ya_existia) {
      await audit({
        user,
        accion: 'CREAR',
        tabla: 'facturas',
        registroId: id,
        despues: await capturar('facturas', id),
        descripcion: 'Dio de alta la factura de un taller',
        ipAddress: getClientIp(req),
      })
    }

    return { status: ya_existia ? 200 : 201, jsonBody: { data: { id, ya_existia } } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-taller-create', {
  methods: ['POST'],
  route: 'facturas/taller',
  authLevel: 'anonymous',
  handler: facturaTallerCreate,
})
