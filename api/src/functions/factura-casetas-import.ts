import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { nombreOCorreo } from '../shared/usuario'
import { FacturaCasetasImportSchema } from '../schemas/facturaCasetasSchema'
import * as service from '../services/facturasCasetasService'

/**
 * Importa la factura de PASE con todos sus cruces.
 *
 * La pantalla lee el XML y manda los cruces ya separados; el service comprueba
 * que sumen el total impreso antes de guardar nada. Quien la importa sale de la
 * sesión, no del cuerpo.
 */
export async function facturaCasetasImport(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const body = FacturaCasetasImportSchema.parse(await req.json())
    const id = await service.importar(body, await nombreOCorreo(user))

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'facturas_casetas',
      registroId: id,
      // Los cruces no van a la bitácora: son cientos y viven en su tabla.
      despues: {
        uuid: body.uuid, serie: body.serie, folio: body.folio, periodo: body.periodo,
        total: body.total, cruces: body.cruces.length,
      },
      descripcion: `Importó la factura de casetas ${body.folio} (${body.cruces.length} cruces)`,
      ipAddress: getClientIp(req),
    })

    return { status: 201, jsonBody: { data: { id } } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-casetas-import', {
  methods: ['POST'],
  route: 'facturas-casetas',
  authLevel: 'anonymous',
  handler: facturaCasetasImport,
})
