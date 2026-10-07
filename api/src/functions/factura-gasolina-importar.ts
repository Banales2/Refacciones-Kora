import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import { FacturaGasolinaImportSchema } from '../schemas/facturaGasolinaSchema'
import * as service from '../services/facturasGasolinaService'

/**
 * Importa la factura de una gasolinera de su XML.
 *
 * La pantalla lee el CFDI y manda los conceptos ya separados; el service
 * reconoce la gasolinera por el permiso de la estación y comprueba que los
 * renglones sumen lo impreso antes de guardar. Después se concilia igual que una
 * capturada a mano.
 */
export async function facturaGasolinaImportar(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const body = FacturaGasolinaImportSchema.parse(await req.json())
    const r = await service.importar(body, await nombreOCorreo(user))

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'facturas_gasolina',
      registroId: r.id,
      despues: await capturar('facturas_gasolina', r.id),
      descripcion: `Importó del XML la factura ${body.folio} de ${r.gasolinera}` +
        (r.ligada ? ` y le ligó el permiso ${body.permiso_cre}` : ''),
      ipAddress: getClientIp(req),
    })

    return { status: 201, jsonBody: { data: r } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-gasolina-importar', {
  methods: ['POST'],
  route: 'facturas-gasolina/importar',
  authLevel: 'anonymous',
  handler: facturaGasolinaImportar,
})
