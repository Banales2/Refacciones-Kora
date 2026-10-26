import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { nombreOCorreo } from '../shared/usuario'
import * as service from '../services/costosService'

// Dar por buena una de las "Cargas que conviene revisar" del tablero, o
// deshacerlo. Ver migración 078: es por bandera y por recarga, porque una
// recarga sin vale y sin kilometraje tiene dos cosas distintas que aclarar.
const Params = z.object({
  tipo:       z.enum(service.TIPOS_REVISABLES),
  recargaId:  z.coerce.number().int().positive(),
})

const Body = z.object({
  // Opcional, como al cerrar un descuadre: obligarla acaba en notas que dicen "ok".
  nota: z.string().trim().max(500, 'Máximo 500 caracteres').nullish(),
})

export async function anomaliaRevisadaMarcar(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const { tipo, recargaId } = Params.parse(req.params)
    const { nota } = Body.parse(await req.json().catch(() => ({})))
    const ok = await service.marcarRevisada(tipo, recargaId, nota || null, await nombreOCorreo(user))
    if (!ok) return { status: 404, jsonBody: { error: 'La recarga ya no existe.' } }

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'anomalias_revisadas',
      registroId: recargaId,
      detalles: { tipo, nota: nota || null },
      ipAddress: getClientIp(req),
    })
    return { status: 200, jsonBody: { data: { tipo, recarga_id: recargaId } } }
  } catch (err) { return handleError(err, ctx) }
}

export async function anomaliaRevisadaQuitar(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const { tipo, recargaId } = Params.parse(req.params)
    const ok = await service.quitarRevisada(tipo, recargaId)
    if (!ok) return { status: 404, jsonBody: { error: 'Esa carga no estaba marcada como revisada.' } }

    await audit({
      user,
      accion: 'ELIMINAR',
      tabla: 'anomalias_revisadas',
      registroId: recargaId,
      detalles: { tipo },
      ipAddress: getClientIp(req),
    })
    return { status: 204 }
  } catch (err) { return handleError(err, ctx) }
}

app.http('dashboard-anomalia-revisada-marcar', {
  methods: ['PUT'],
  route: 'dashboard/anomalias-revisadas/{tipo}/{recargaId}',
  authLevel: 'anonymous',
  handler: anomaliaRevisadaMarcar,
})

// POST a una acción y no DELETE: la API no expone ese verbo (docs/sin-delete.md).
app.http('dashboard-anomalia-revisada-quitar', {
  methods: ['POST'],
  route: 'dashboard/anomalias-revisadas/{tipo}/{recargaId}/quitar',
  authLevel: 'anonymous',
  handler: anomaliaRevisadaQuitar,
})
