import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/facturasGasolinaService'

/**
 * Qué recargas podría estar cubriendo esta factura, con la propuesta ya hecha.
 *
 * Las candidatas son las de su gasolinera, de su fecha hacia atrás, que ninguna
 * otra factura haya reclamado. Vienen con `sugerida` marcada según el criterio
 * de `facturasGasolinaService.candidatas`: de la más reciente hacia atrás,
 * mientras quepan sin pasarse del total.
 *
 * Una factura ya sellada devuelve lo que se llevó, sin candidatas libres: no hay
 * nada que proponerle, y enseñar las sueltas junto a las suyas invitaría a
 * tocarlas.
 */
export async function facturaGasolinaCandidatas(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    return { status: 200, jsonBody: { data: await service.candidatas(id) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-gasolina-candidatas', {
  methods: ['GET'],
  route: 'facturas-gasolina/{id}/candidatas',
  authLevel: 'anonymous',
  handler: facturaGasolinaCandidatas,
})
