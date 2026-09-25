import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, soloVisibles } from '../shared/alcance'
import * as service from '../services/valesGasolinaService'

export async function valesGasolinaList(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor', 'lector', 'practicante', 'responsable')
    // Los archivados solo cuando se piden: un vale que se dio por perdido ya no
    // es trabajo de nadie, y dejarlo en la lista de todos los dias hace que la
    // lista deje de mirarse.
    const incluirArchivados = request.query.get('archivados') === '1'
    const data = await soloVisibles(
      await service.getAll(incluirArchivados), await alcanceDe(user),
    )
    return { status: 200, jsonBody: { data } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('vales-gasolina-list', {
  methods: ['GET'],
  route: 'vales-gasolina',
  authLevel: 'anonymous',
  handler: valesGasolinaList,
})
