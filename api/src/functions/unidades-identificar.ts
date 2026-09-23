import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError, ConflictError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import * as repo from '../repositories/unidadesPiezaRepo'

// Un folio por pieza. Los vacíos crean la unidad sin etiqueta: la pieza existe
// aunque no traiga número grabado, y obligar a inventarle uno sería peor.
const Schema = z.object({
  grupos: z.array(z.object({
    pieza_id:    z.coerce.number().int().positive(),
    lote_id:     z.coerce.number().int().positive(),
    sucursal_id: z.coerce.number().int().positive().nullish(),
    etiquetas:   z.array(z.string().trim().max(40)).min(1).max(999),
  })).min(1, 'No hay nada que identificar').max(50),
})

export async function unidadesIdentificar(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const user = requireRole(request, 'admin', 'editor')
    const { grupos } = Schema.parse(await request.json())

    // Dos piezas no pueden llevar el mismo folio dentro de una refacción. El
    // índice único lo rechazaría igual, pero solo después de haber creado media
    // tanda y sin decir cuál choca.
    const vistos = new Map<string, Set<string>>()
    for (const g of grupos) {
      if (!vistos.has(String(g.pieza_id))) vistos.set(String(g.pieza_id), new Set())
      const folios = vistos.get(String(g.pieza_id))!
      for (const e of g.etiquetas) {
        const folio = e.trim()
        if (!folio) continue
        if (folios.has(folio.toUpperCase())) {
          throw new ConflictError(`El identificador ${folio} se repite`)
        }
        folios.add(folio.toUpperCase())
      }
    }

    const creadas = await repo.crearIdentificadas(grupos)

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'unidades_pieza',
      registroId: grupos[0].pieza_id,
      detalles: {
        unidades_creadas: creadas,
        con_etiqueta: grupos.reduce((n, g) => n + g.etiquetas.filter((e) => e.trim()).length, 0),
        origen: 'stock_existente',
      },
      ipAddress: getClientIp(request),
    })

    return { status: 201, jsonBody: { data: { creadas } } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('unidades-identificar', {
  methods: ['POST'],
  route: 'unidades/identificar',
  authLevel: 'anonymous',
  handler: unidadesIdentificar,
})
