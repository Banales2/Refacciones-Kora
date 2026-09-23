import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { exigirSucursalAsignada } from '../shared/alcance'
import * as service from '../services/sucursalesService'

// A qué sucursales se puede mandar un traspaso. Existe aparte de /sucursales
// porque esa lista se acota: el responsable sólo recibe la suya, y con ella no
// tendría a dónde enviar. Aquí van todas las que están en uso, pero sólo id y
// nombre: para elegir el destino no hace falta más, y la ubicación de las otras
// sucursales no es asunto suyo.
export async function inventarioTraspasoDestinos(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'responsable')
    await exigirSucursalAsignada(user)
    const data = (await service.getAll()).map((s) => ({ id: s.id, nombre: s.nombre }))
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('inventario-traspaso-destinos', {
  methods: ['GET'],
  route: 'inventario/traspasos/destinos',
  authLevel: 'anonymous',
  handler: inventarioTraspasoDestinos,
})
