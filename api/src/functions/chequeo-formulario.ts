import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/chequeosService'

/**
 * Qué preguntas le tocan a esta unidad, su odómetro actual y el chequeo de hoy
 * si ya lo tiene.
 *
 * El formulario lo pide al abrirse en lugar de deducirlo del tipo: la
 * aplicación es una PWA instalada en los teléfonos del patio, y una pregunta
 * nueva tendría que esperar a que cada uno actualizara. Así aparece al día
 * siguiente, y el espejo del front (`lib/chequeoItems.ts`) queda solo como
 * respaldo para pintar el historial.
 */
export async function chequeoFormulario(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector', 'responsable')
    const vehiculoId = parseInt(req.params.vehiculoId, 10)
    if (isNaN(vehiculoId)) return { status: 400, jsonBody: { error: 'ID de vehículo inválido' } }

    const [formulario, hoy] = await Promise.all([
      service.getFormulario(vehiculoId),
      service.getDelDia(vehiculoId),
    ])
    return { status: 200, jsonBody: { data: { ...formulario, hoy } } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('chequeo-formulario', {
  methods: ['GET'],
  route: 'vehiculos/{vehiculoId}/chequeos/formulario',
  authLevel: 'anonymous',
  handler: chequeoFormulario,
})
