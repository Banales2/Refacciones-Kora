import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, exigirVehiculo } from '../shared/alcance'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { ValeGasolinaCreateSchema } from '../schemas/valeGasolinaSchema'
import * as service from '../services/valesGasolinaService'

export async function valesGasolinaCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor', 'practicante', 'responsable')
    const data = ValeGasolinaCreateSchema.parse(await request.json())
    const alcance = await alcanceDe(user)
    await exigirVehiculo(data.vehiculo_id, alcance)
    // El vale queda a nombre de quien tiene la sesión, salvo que elija otra
    // cuenta (le pasaron el vale de otra persona); el servicio valida que sea
    // una de las permitidas. Si está acotado a una sucursal, el vale es de esa.
    const created = await service.create(data, user.userDetails, alcance.sucursalId)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'vales_gasolina',
      registroId: created.id,
      despues: await capturar('vales_gasolina', created.id),
      detalles: {
        folio: created.folio, creado_por: created.creado_por,
        // Solo cuando no coinciden: es lo único que dice que lo capturó otra
        // persona, porque la columna guarda a quien entregó el papel.
        ...(created.creado_por !== user.userDetails ? { capturado_por: user.userDetails } : {}),
        conductor: created.conductor,
        vehiculo: created.serie, sucursal: created.sucursal, fecha: created.fecha,
      },
      ipAddress: getClientIp(request),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('vales-gasolina-create', {
  methods: ['POST'],
  route: 'vales-gasolina',
  authLevel: 'anonymous',
  handler: valesGasolinaCreate,
})
