import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as service from '../services/piezasVehiculoService'
import { EtiquetaPiezaSchema } from '../schemas/tipoPiezaSchema'

// Fecha calendario, sin hora: es el día en que se montó la pieza.
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (AAAA-MM-DD)')

// Todo lo que no sea `pieza_id` es opcional: la trazabilidad se captura cuando
// se puede, y no poder capturarla no debe impedir asignar la pieza. Los campos
// de retiro describen a la pieza que SALE, y solo aplican si esto reemplaza
// una anterior.
const Schema = z.object({
  pieza_id:          z.coerce.number().int().positive(),
  // Cuál de los renglones de ese tipo se está montando ('' = el único que hay).
  etiqueta:          EtiquetaPiezaSchema,
  lote_id:           z.coerce.number().int().positive().nullish(),
  fecha_instalacion: Fecha.nullish(),
  km_instalacion:    z.coerce.number().int().nonnegative().nullish(),
  mantenimiento_id:  z.coerce.number().int().positive().nullish(),
  motivo_retiro:     z.enum(['desgaste', 'falla', 'robo', 'siniestro', 'preventivo', 'garantia']).nullish(),
  destino:           z.enum(['desecho', 'reacondicionar', 'devolucion_proveedor', 'venta', 'stock']).nullish(),
  km_retiro:         z.coerce.number().int().nonnegative().nullish(),
})

export async function vehiculoPiezasSet(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id     = parseInt(request.params.id, 10)
    const tipoId = parseInt(request.params.tipoId, 10)
    if (isNaN(id) || isNaN(tipoId)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const { pieza_id, etiqueta, ...datos } = Schema.parse(await request.json())
    await service.setPieza(id, tipoId, etiqueta, pieza_id, datos)

    await audit({
      user, accion: 'EDITAR', tabla: 'piezas_vehiculo',
      registroId: id, detalles: { tipo_pieza_id: tipoId, etiqueta, pieza_id, ...datos },
      ipAddress: getClientIp(request),
    })

    return { status: 204 }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('vehiculo-piezas-set', {
  methods: ['PUT'],
  route: 'vehiculos/{id}/piezas/{tipoId}',
  authLevel: 'anonymous',
  handler: vehiculoPiezasSet,
})
