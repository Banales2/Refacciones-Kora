import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError, ValidationError } from '../shared/errors'
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
/**
 * `?elegidos=renglon:ticket,renglon:ticket`: lo que la pantalla lleva elegido
 * sin guardar, para volver a buscar coincidencias sin pisarlo ni proponer un
 * ticket ya ocupado. Vacío (`?elegidos=`) es "ninguno elegido"; sin el
 * parámetro, manda lo guardado. Un par mal formado es un 400, no se ignora: se
 * propondría un ticket que la pantalla ya tiene en otro renglón.
 */
function leerElegidos(raw: string | null): Map<number, number> | undefined {
  if (raw === null) return undefined
  const m = new Map<number, number>()
  for (const par of raw.split(',').filter(Boolean)) {
    const [r, t] = par.split(':').map((x) => Number(x))
    if (!Number.isInteger(r) || !Number.isInteger(t) || r <= 0 || t <= 0) {
      throw new ValidationError('Parámetro elegidos inválido')
    }
    m.set(r, t)
  }
  return m
}

export async function facturaGasolinaCandidatas(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    return { status: 200, jsonBody: { data: await service.candidatas(id, leerElegidos(req.query.get('elegidos'))) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-gasolina-candidatas', {
  methods: ['GET'],
  route: 'facturas-gasolina/{id}/candidatas',
  authLevel: 'anonymous',
  handler: facturaGasolinaCandidatas,
})
