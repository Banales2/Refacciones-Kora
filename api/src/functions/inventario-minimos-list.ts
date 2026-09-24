import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe, sucursalPermitida } from '../shared/alcance'
import * as service from '../services/inventarioService'

// Límites configurados —mínimo, máximo o los dos—, cada uno con la existencia
// actual de esa refacción en esa sucursal para poder compararlos.
//
// Con `faltantes=1` devuelve solo los que están por debajo del mínimo, que es
// la lista que hay que salir a surtir; con `excedentes=1`, los que pasan del
// máximo, que es lo que conviene dejar de comprar o mover a otra sucursal.
export async function inventarioMinimosList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'lector', 'responsable')

    const sucursalRaw = req.query.get('sucursal')
    const pedida = sucursalRaw ? parseInt(sucursalRaw, 10) : undefined
    if (sucursalRaw && isNaN(pedida!)) {
      return { status: 400, jsonBody: { error: 'Sucursal inválida' } }
    }
    const sucursalId = sucursalPermitida(pedida, await alcanceDe(user))

    const data =
      req.query.get('faltantes')  === '1' ? await service.getFaltantes(sucursalId)  :
      req.query.get('excedentes') === '1' ? await service.getExcedentes(sucursalId) :
      await service.getMinimos(sucursalId)

    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('inventario-minimos-list', {
  methods: ['GET'],
  route: 'inventario/minimos',
  authLevel: 'anonymous',
  handler: inventarioMinimosList,
})
