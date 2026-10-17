import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/facturasGasolinaService'

const Query = z.object({ q: z.string().trim().max(40) })

/**
 * Con el vale en la mano: su recarga y la factura que la cobra. Si ningún
 * renglón la tiene casada todavía, las facturas que probablemente la cobran
 * —su gasolinera, mismos litros, renglón libre—, porque la propuesta del cuadre
 * no se guarda hasta conciliar y el buscador de facturas no la ve.
 */
export async function facturasGasolinaPorVale(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector')
    const { q } = Query.parse({ q: req.query.get('q') ?? '' })
    return { status: 200, jsonBody: { data: await service.buscarPorVale(q) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('facturas-gasolina-por-vale', {
  methods: ['GET'],
  route: 'facturas-gasolina/por-vale',
  authLevel: 'anonymous',
  handler: facturasGasolinaPorVale,
})
