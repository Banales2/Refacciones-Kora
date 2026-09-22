import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/chequeosService'

// El recorrido del patio de una sucursal: qué unidades le faltan hoy y cuáles
// ya se revisaron, en una sola consulta. Es lo que sostiene el modo patio, donde
// una o dos personas caminan la flota entera sin abrir la ficha de cada unidad.
export async function chequeosPatio(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector', 'responsable')
    const sucursalId = parseInt(req.query.get('sucursal_id') ?? '', 10)
    if (isNaN(sucursalId)) return { status: 400, jsonBody: { error: 'Falta la sucursal' } }
    const fecha = req.query.get('fecha') ?? undefined

    const data = await service.getPatio(sucursalId, fecha)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('chequeos-patio', {
  methods: ['GET'],
  route: 'chequeos/patio',
  authLevel: 'anonymous',
  handler: chequeosPatio,
})
