import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/cuadreFacturaService'
import * as manoObraService from '../services/manoObraService'

/**
 * Los mantenimientos que esta factura podría estar cobrando.
 *
 * Los del taller que la emitió, con fecha menor o igual a la suya, que ningún
 * renglón de ninguna OTRA factura haya reclamado. Los reclamados por esta sí
 * salen: hay que poder cambiar lo que ya se eligió.
 *
 * NO PROPONE NADA POR IMPORTE, ni siquiera "el más cercano". Dos servicios del
 * mismo taller pueden costar lo mismo sin ser el mismo trabajo, y un
 * emparejamiento inventado que nadie revisa es peor que ninguno — es la misma
 * decisión que en gasolina, donde solo se propone por litros exactos. Aquí lo
 * elige una persona viendo la unidad y la fecha.
 *
 * Devuelve también el taller, para que la pantalla pueda decir de quién es el
 * papel. Es `null` cuando la factura no es de ningún taller, y entonces no hay
 * mano de obra que cuadrar.
 */
export async function facturaManoObraCandidatos(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer', 'responsable')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const [candidatos, taller] = await Promise.all([
      service.candidatosManoObra(id),
      manoObraService.tallerDeFactura(id),
    ])

    return { status: 200, jsonBody: { data: candidatos, taller } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-mano-obra-candidatos', {
  methods: ['GET'],
  route: 'facturas/{id}/mano-obra/candidatos',
  authLevel: 'anonymous',
  handler: facturaManoObraCandidatos,
})
