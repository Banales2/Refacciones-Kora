import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { CasetaPaseUpdateSchema } from '../schemas/facturaCasetasSchema'
import * as service from '../services/facturasCasetasService'

/**
 * Marca que una caseta no manda la clase real (EASYTRIP manda 1 a todo): su
 * importe se compara contra todas las clasificaciones. Solo admin, como las
 * tarifas: cambia qué cuenta como fuera de tarifa.
 */
export async function casetasPaseUpdate(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin')
    const caseta = (req.params.caseta ?? '').trim()
    if (!caseta || caseta.length > 10) return { status: 400, jsonBody: { error: 'Caseta inválida' } }
    const body = CasetaPaseUpdateSchema.parse(await req.json())
    await service.guardarIgnoraClase(caseta, body.ignora_clase)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'casetas_pase',
      registroId: caseta,
      despues: { caseta, ignora_clase: body.ignora_clase },
      descripcion: body.ignora_clase
        ? `Marcó que la caseta ${caseta} no manda la clase real`
        : `Marcó que la caseta ${caseta} sí manda la clase real`,
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: { caseta, ignora_clase: body.ignora_clase } } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('casetas-pase-update', {
  methods: ['PUT'],
  route: 'casetas-pase/{caseta}',
  authLevel: 'anonymous',
  handler: casetasPaseUpdate,
})
