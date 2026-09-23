import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe } from '../shared/alcance'
import * as service from '../services/chequeosService'
import { ChequeoQuerySchema } from '../schemas/chequeoSchema'

// Los chequeos de la flota por rango de fechas. Sin fechas responde el día de
// hoy: una tabla que crece un renglón por unidad por día no se lista completa.
export async function chequeosList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'lector', 'responsable')
    const params = ChequeoQuerySchema.parse({
      desde:       req.query.get('desde')       ?? undefined,
      hasta:       req.query.get('hasta')       ?? undefined,
      vehiculo_id: req.query.get('vehiculo_id') ?? undefined,
      filtro:      req.query.get('filtro')      ?? undefined,
    })
    const data = await service.getRango(params, await alcanceDe(user))
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('chequeos-list', {
  methods: ['GET'],
  route: 'chequeos',
  authLevel: 'anonymous',
  handler: chequeosList,
})
