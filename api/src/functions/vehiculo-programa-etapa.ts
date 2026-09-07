// Fija a mano en qué etapa va la unidad, o suelta la decisión para que vuelva a
// calcularse contra su garantía principal.
//
// Existe porque el cálculo no cubre todos los casos reales: una unidad puede
// haber perdido la garantía por un choque —y entonces conviene adelantarla al
// programa de después—, o el fabricante puede haberla respetado pese al
// vencimiento formal, y entonces se la quiere retener en el del manual.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/programaVehiculoService'
import { EtapaForzadaSchema } from '../schemas/programaVehiculoSchema'

export async function vehiculoProgramaEtapa(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    const { etapa } = EtapaForzadaSchema.parse(await req.json())
    const estado = await service.setEtapa(vehiculoId, etapa)
    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'vehiculo_programa',
      registroId: vehiculoId,
      despues: { etapa_forzada: etapa },
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: estado } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('vehiculo-programa-etapa', {
  methods: ['PUT'],
  route: 'vehiculos/{vehiculoId}/programa/etapa',
  authLevel: 'anonymous',
  handler: vehiculoProgramaEtapa,
})
