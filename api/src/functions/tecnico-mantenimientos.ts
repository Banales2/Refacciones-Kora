import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/mantenimientoService'

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
})

/**
 * Los mantenimientos que hizo un taller.
 *
 * El gemelo de `GET /tecnicos/{id}/facturas`: aquel enseña lo que el taller ha
 * cobrado, este lo que ha hecho. Juntos son la ficha del taller, y la pregunta
 * interesante está en el cruce — un trabajo sin folio que lo reclame es mano de
 * obra que todavía no se ha facturado.
 *
 * Es el estado de cuentas con un taller, no el historial de la flota. Ese sigue
 * siendo `GET /mantenimientos`, que trae la flota entera sin paginar: aquí eso
 * sería leer años de trabajo para enseñar diez renglones.
 */
export async function tecnicoMantenimientos(
  req: HttpRequest, ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const p = QuerySchema.parse({
      page: req.query.get('page') ?? undefined,
      pageSize: req.query.get('pageSize') ?? undefined,
    })

    const r = await service.getByTecnico(id, p.page, p.pageSize)
    return {
      status: 200,
      jsonBody: {
        data: r.data,
        costo_total: r.costo_total,
        pagination: { page: r.page, pageSize: r.pageSize, total: r.total },
      },
    }
  } catch (err) { return handleError(err, ctx) }
}

app.http('tecnico-mantenimientos', {
  methods: ['GET'],
  route: 'tecnicos/{id}/mantenimientos',
  authLevel: 'anonymous',
  handler: tecnicoMantenimientos,
})
