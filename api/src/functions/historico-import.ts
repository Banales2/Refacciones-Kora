import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { ImportacionHistoricaSchema } from '../schemas/historicoSchema'
import { nombreOCorreo } from '../shared/usuario'
import * as service from '../services/historicoService'

export async function historicoImport(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const body = ImportacionHistoricaSchema.parse(await request.json())
    // Quien sube el archivo es quien lo autoriza, igual que en una compra: sale
    // de la sesión, no del cuerpo.
    const resultado = await service.importar(body, await nombreOCorreo(user))

    // UNA entrada por importación, no una por factura ni una por lote. La
    // bitácora de una compra va por registro porque cada lote se capturó a
    // mano y se puede discutir uno; una importación es un solo acto —se soltó
    // este archivo, de este proveedor, este día— y partirla en doscientas
    // entradas enterraría el resto del día en la pantalla de cambios.
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'facturas',
      descripcion:
        `Importación de histórico: ${resultado.facturas_creadas} facturas, ` +
        `${resultado.renglones_creados} renglones, ` +
        `${resultado.piezas_nuevas.length} refacciones nuevas`,
      detalles: {
        proveedor_id:      body.proveedor_id,
        sucursal_id:       body.sucursal_id,
        facturas_creadas:  resultado.facturas_creadas,
        renglones_creados: resultado.renglones_creados,
        folios_omitidos:   resultado.folios_omitidos,
        piezas_nuevas:     resultado.piezas_nuevas.map((p) => p.numero_serie),
      },
      ipAddress: getClientIp(request),
    })

    return { status: 201, jsonBody: { data: resultado } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('historico-import', {
  methods: ['POST'],
  route: 'compras/historicas',
  authLevel: 'anonymous',
  handler: historicoImport,
})
