import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, exigirVehiculo } from '../shared/alcance'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { RecargaCreateSchema } from '../schemas/recargaSchema'
import * as service from '../services/recargasService'

export async function recargaCreate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    // El practicante también: entrega los vales, y la recarga es la otra mitad
    // del mismo papel. Corregirla (`recarga-update`) es del editor, y del
    // practicante solo en las que él capturó; la de emergencia, del admin.
    const user = requireRole(request, 'admin', 'editor', 'practicante', 'responsable')
    const vehiculoId = parseInt(request.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }
    await exigirVehiculo(vehiculoId, await alcanceDe(user))

    const data = RecargaCreateSchema.parse(await request.json())
    // Si la recarga corrige la unidad del vale, ese cambio va a la bitácora
    // como edición del vale, con su propio antes y después.
    const valeAntes = data.corregir_vale ? await capturar('vales_gasolina', data.vale_id) : null
    const created = await service.create(vehiculoId, data, user.userDetails)

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'recargas_combustible',
      registroId: created.id,
      despues: await capturar('recargas_combustible', created.id),
      detalles: { vehiculo_id: vehiculoId, litros: created.litros, costo: created.costo, tickets: created.tickets.length },
      ipAddress: getClientIp(request),
    })
    if (valeAntes) {
      const valeDespues = await capturar('vales_gasolina', data.vale_id)
      if (JSON.stringify(valeAntes) !== JSON.stringify(valeDespues)) {
        await audit({
          user,
          accion: 'EDITAR',
          tabla: 'vales_gasolina',
          registroId: data.vale_id,
          antes: valeAntes,
          despues: valeDespues,
          detalles: { por_recarga: created.id },
          ipAddress: getClientIp(request),
        })
      }
    }

    return { status: 201, jsonBody: { data: created } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('recarga-create', {
  methods: ['POST'],
  route: 'vehiculos/{vehiculoId}/recargas',
  authLevel: 'anonymous',
  handler: recargaCreate,
})
