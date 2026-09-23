import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, soloDeSucursal } from '../shared/alcance'
import { audit } from '../shared/audit'
import * as service from '../services/refaccionesService'
import { sinDatosDeCompra } from '../shared/datosDeCompra'

export async function piezasLotes(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor', 'lector', 'practicante', 'responsable')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const { pieza, lotes } = await service.getLotesByPiezaId(id)
    const data = { pieza, lotes: sinDatosDeCompra(soloDeSucursal(lotes, await alcanceDe(user)), user) }
    await audit({ user, accion: 'VER_SENSIBLE', tabla: 'lotes_pieza', registroId: id })
    return { status: 200, jsonBody: data }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('piezas-lotes', {
  methods: ['GET'],
  route: 'piezas/{id}/lotes',
  authLevel: 'anonymous',
  handler: piezasLotes,
})
