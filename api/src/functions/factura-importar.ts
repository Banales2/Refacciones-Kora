import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import { FacturaCfdiImportSchema } from '../schemas/importarCfdiSchema'
import * as service from '../services/importarCfdiService'

/**
 * Importa una factura de refacciones de su XML (CFDI 4.0): la factura, sus
 * lotes, la mano de obra y los cargos, con el papel ya transcrito para el
 * cuadre. No la sella: eso lo hace el admin en la revisión. Ver la migración
 * 070 y docs/importar-facturas-de-refacciones.md.
 *
 * Los mismos roles que el alta de compra: es la misma operación, con el papel
 * leído en vez de tecleado.
 */
export async function facturaImportar(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const data = FacturaCfdiImportSchema.parse(await req.json())
    const r = await service.importar(data, await nombreOCorreo(user))

    const ip = getClientIp(req)
    if (r.proveedor_nuevo) {
      await audit({
        user, accion: 'CREAR', tabla: 'proveedores', registroId: r.proveedor_id,
        despues: await capturar('proveedores', r.proveedor_id),
        detalles: { desde_cfdi: data.uuid }, ipAddress: ip,
      })
    }
    await audit({
      user, accion: 'CREAR', tabla: 'facturas', registroId: r.factura_id,
      despues: await capturar('facturas', r.factura_id),
      descripcion: `Importó del XML la factura ${r.folio} de ${r.proveedor}`,
      detalles: { uuid: data.uuid, conceptos: data.conceptos.length, lotes: r.lotes.length },
      ipAddress: ip,
    })
    for (const lote of r.lotes) {
      if (lote.pieza_nueva) {
        await audit({
          user, accion: 'CREAR', tabla: 'piezas', registroId: lote.pieza_id,
          despues: await capturar('piezas', lote.pieza_id),
          detalles: { num_factura: r.folio, desde_cfdi: data.uuid }, ipAddress: ip,
        })
      }
      await audit({
        user, accion: 'CREAR', tabla: 'lotes_pieza', registroId: lote.id,
        despues: await capturar('lotes_pieza', lote.id),
        detalles: { pieza_id: lote.pieza_id, num_factura: r.folio, desde_cfdi: data.uuid },
        ipAddress: ip,
      })
    }

    return { status: 201, jsonBody: { data: r } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-importar', {
  methods: ['POST'],
  route: 'facturas/importar',
  authLevel: 'anonymous',
  handler: facturaImportar,
})
