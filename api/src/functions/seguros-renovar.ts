// Renovar una póliza, de las dos maneras en que se renueva de verdad: la
// aseguradora prolonga la misma, o sale otra póliza que cubre las mismas
// unidades. Ver `segurosService.renovar` para por qué la anterior no se borra.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { SeguroRenovarSchema } from '../schemas/seguroSchema'
import * as service from '../services/segurosService'

export async function segurosRenovar(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const body = SeguroRenovarSchema.parse(await request.json())
    const antes = await capturar('seguros', id)
    const renovacion = await service.renovar(id, body)

    // Extender edita la póliza que ya existía; la póliza nueva es un alta. Se
    // registran distinto para que la bitácora no diga que se creó algo cuando
    // solo se corrió una fecha.
    await audit({
      user,
      accion:     renovacion.modo === 'extender' ? 'EDITAR' : 'CREAR',
      tabla:      'seguros',
      registroId: renovacion.seguro.id,
      antes:      renovacion.modo === 'extender' ? antes : undefined,
      despues:    await capturar('seguros', renovacion.seguro.id),
      detalles: {
        renovacion:        renovacion.modo,
        poliza_anterior:   renovacion.anterior.poliza,
        vehiculos_movidos: renovacion.vehiculos_movidos,
      },
      ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: renovacion } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('seguros-renovar', {
  methods: ['POST'],
  route: 'seguros/{id}/renovar',
  authLevel: 'anonymous',
  handler: segurosRenovar,
})
