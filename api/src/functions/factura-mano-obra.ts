import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { ManoObraSchema } from '../schemas/manoObraSchema'
import * as service from '../services/cuadreFacturaService'

/**
 * Guarda la mano de obra que cobra el papel.
 *
 * Es el gemelo de `PUT /facturas/{id}/renglones` para la otra mitad del
 * documento: allá se transcriben las refacciones, aquí los servicios. Las dos
 * escriben sobre la MISMA factura, porque el taller cobra las dos cosas en el
 * mismo papel y ese papel es una sola fila.
 *
 * Reemplaza la transcripción completa y devuelve el cuadre recalculado —las dos
 * mitades—, así que la pantalla ve el efecto de lo que acaba de capturar sin
 * pedirlo aparte.
 *
 * Solo admin: transcribir el papel es el trabajo del verificador.
 */
export async function facturaManoObra(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const body = ManoObraSchema.parse(await req.json())
    const renglones = body.renglones.map((r) => ({
      mantenimiento_id: r.mantenimiento_id ?? null,
      importe: r.importe,
    }))

    return { status: 200, jsonBody: { data: await service.guardarManoObra(id, renglones) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('factura-mano-obra', {
  methods: ['PUT'],
  route: 'facturas/{id}/mano-obra',
  authLevel: 'anonymous',
  handler: facturaManoObra,
})
