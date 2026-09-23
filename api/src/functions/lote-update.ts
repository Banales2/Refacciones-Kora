import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { LoteUpdateSchema } from '../schemas/loteSchema'
import { assertLoteEditable } from '../shared/revision'
import * as service from '../services/lotesService'

// Qué campos del cuerpo son del RENGLÓN y cuáles de la CABECERA de su factura.
//
// Importa porque son dos candados distintos: `lotesRepo.update` aplica el
// proveedor, la fecha, el IVA y quién compró sobre la factura entera —y por
// tanto sobre todos sus renglones—, mientras que el costo y la cantidad son de
// este lote y de ninguno más. Cambiar el IVA "de un lote" tiene que chocar con
// el sello de la cabecera aunque este renglón todavía no esté revisado.
//
// `num_factura` cuenta como cabecera: mover el renglón a otra factura le cambia
// el total a las dos.
const CAMPOS_CABECERA = ['proveedor_id', 'fecha_compra', 'tasa_iva', 'comprado_por', 'num_factura']
const CAMPOS_RENGLON = ['costo_unitario', 'cantidad_inicial']

export async function loteUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const body = LoteUpdateSchema.parse(await request.json())

    // Lo ya verificado contra el papel no se edita por la puerta de atrás. El
    // candado va aquí y no en el service porque la revisión misma pasa por el
    // service para aplicar sus correcciones: si estuviera allí, el verificador
    // no podría corregir nada.
    await assertLoteEditable(id, {
      tocaRenglon: CAMPOS_RENGLON.some((c) => c in body),
      tocaCabecera: CAMPOS_CABECERA.some((c) => c in body),
    })

    const antes = await capturar('lotes_pieza', id)
    const updated = await service.updateLote(id, body)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'lotes_pieza',
      registroId: id,
      antes,
      despues: await capturar('lotes_pieza', id),
      ipAddress: getClientIp(request),
    })

    return { status: 200, jsonBody: { data: updated } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('lote-update', {
  methods: ['PUT', 'PATCH'],
  route: 'lotes/{id}',
  authLevel: 'anonymous',
  handler: loteUpdate,
})
