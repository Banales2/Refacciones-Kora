import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe } from '../shared/alcance'
import * as service from '../services/valesGasolinaService'

// A nombre de quién se puede registrar un vale, para el selector "Creado por"
// del formulario. Mismos roles que el alta: solo lo necesita quien registra.
export async function valesGasolinaCuentas(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor', 'practicante', 'responsable')
    const data = await service.getCuentas((await alcanceDe(user)).sucursalId)
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('vales-gasolina-cuentas', {
  methods: ['GET'],
  route: 'vales-gasolina/cuentas',
  authLevel: 'anonymous',
  handler: valesGasolinaCuentas,
})
