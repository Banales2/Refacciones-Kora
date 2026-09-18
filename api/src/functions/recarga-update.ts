import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { RecargaUpdateSchema } from '../schemas/recargaSchema'
import * as facturasGasolinaRepo from '../repositories/facturasGasolinaRepo'
import { AppError } from '../shared/errors'
import * as service from '../services/recargasService'

// Los campos que, al cambiar, rompen una conciliación ya cerrada.
//
// `costo` es el obvio: es el número que se cuadró contra el total de la factura.
// `fecha` y `gasolinera_id` lo son igual de verdad aunque no lo parezcan —
// deciden si esta recarga era siquiera candidata de esa factura, y moverlos deja
// dentro de una factura una carga que nunca le tocó.
//
// Lo demás —chofer, vale, kilometraje, litros— no toca el cuadre y se sigue
// corrigiendo con la factura cerrada, que es lo correcto: son datos de la
// operación, no del papel de la gasolinera.
const CAMPOS_DEL_CUADRE = ['costo', 'fecha', 'gasolinera_id']

export async function recargaUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const data = RecargaUpdateSchema.parse(await request.json())

    // Una recarga que ya entró en una factura conciliada no puede cambiar de
    // importe ni de sitio: el cuadre se hizo con ese número y dejaría de ser
    // cierto sin que nadie se enterara. Para corregirla hay que reabrir la
    // factura, volver a cuadrarla y sellarla otra vez.
    if (CAMPOS_DEL_CUADRE.some((c) => c in data)) {
      const factura = await facturasGasolinaRepo.facturaDeRecarga(id)
      if (factura?.conciliada) {
        throw new AppError(
          `Esta recarga ya está conciliada en la factura ${factura.folio}. ` +
          'Reábrela para poder corregir el importe, la fecha o la gasolinera.',
          409, 'RECARGA_CONCILIADA',
        )
      }
    }

    const antes = await capturar('recargas_combustible', id)
    const updated = await service.update(id, data)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'recargas_combustible',
      registroId: id,
      antes,
      despues: await capturar('recargas_combustible', id),
      ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: updated } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('recarga-update', {
  methods: ['PUT', 'PATCH'],
  route: 'recargas/{id}',
  authLevel: 'anonymous',
  handler: recargaUpdate,
})
