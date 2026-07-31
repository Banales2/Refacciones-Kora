import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { ValeGasolinaCreateSchema } from '../schemas/valeGasolinaSchema'
import * as service from '../services/valesGasolinaService'

export async function valesGasolinaCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const data = ValeGasolinaCreateSchema.parse(await request.json())
    // Quien crea el vale es siempre el usuario de la sesión.
    const created = await service.create(data, user.userDetails)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'vales_gasolina',
      registroId: created.id,
      despues: await capturar('vales_gasolina', created.id),
      detalles: { conductor: created.conductor, vehiculo: created.serie, fecha: created.fecha },
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
