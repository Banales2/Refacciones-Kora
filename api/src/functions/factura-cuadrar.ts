import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { nombreOCorreo } from '../shared/usuario'
import { CuadrarSchema } from '../schemas/cuadreSchema'
import * as service from '../services/cuadreFacturaService'

/**
 * Aplica lo que dice el papel y sella la factura entera.
 *
 * Corrige los lotes cuya cantidad o costo no coinciden, registra cada error con
 * su importe y a nombre de quien lo capturó, y sella cabecera y renglones de una
 * vez — el cuadre es de la factura completa, no de un renglón suelto.
 *
 * Lo que queda sin resolver —una refacción del papel que nadie capturó, o una
 * capturada que el papel no trae— también se registra: perderlo porque alguien
 * cerró la factura sería quedarse sin la respuesta.
 *
 * Solo admin.
 */
export async function facturaCuadrar(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const body = CuadrarSchema.parse(await req.json())
    const antes = await capturar('facturas', id)

    const r = await service.cuadrar(
      id, body.nota ?? null, body.confirmar_sin_resolver, await nombreOCorreo(user),
    )

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'facturas',
      registroId: id,
      antes,
      despues: await capturar('facturas', id),
      descripcion: r.correcciones === 0
        ? 'Cuadró la factura contra el papel: coincide'
        : `Cuadró la factura: ${r.correcciones} diferencia(s) por ${r.delta_total.toFixed(2)}`,
      detalles: {
        correcciones: r.correcciones,
        delta_total: r.delta_total,
        sin_resolver: r.sin_resolver,
      },
      ipAddress: getClientIp(req),
    })

    return { status: 200, jsonBody: { data: r } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-cuadrar', {
  methods: ['POST'],
  route: 'facturas/{id}/cuadrar',
  authLevel: 'anonymous',
  handler: facturaCuadrar,
})
