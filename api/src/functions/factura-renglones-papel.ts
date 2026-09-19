import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { RenglonesPapelSchema } from '../schemas/cuadreSchema'
import * as service from '../services/cuadreFacturaService'

/**
 * Guarda lo que dice el papel de una factura.
 *
 * Reemplaza la transcripción completa: la pantalla manda el papel entero y el
 * servidor sustituye lo que había. Devuelve el cuadre recalculado, así que la
 * pantalla ve el efecto de lo que acaba de capturar sin pedirlo aparte.
 *
 * Solo admin: transcribir el papel es el trabajo del verificador.
 */
export async function facturaRenglonesPapel(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const body = RenglonesPapelSchema.parse(await req.json())
    return { status: 200, jsonBody: { data: await service.guardarRenglones(id, body) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-renglones-papel', {
  methods: ['PUT'],
  route: 'facturas/{id}/renglones',
  authLevel: 'anonymous',
  handler: facturaRenglonesPapel,
})
