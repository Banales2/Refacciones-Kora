import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as repo from '../repositories/chequeosRepo'

/**
 * Cómo se ha ido gastando una pieza, medición por medición.
 *
 * Es la consulta que justifica que la lectura guarde de qué unidad era: la
 * llanta puede haber pasado por tres ejes y dos camiones, y su curva es una
 * sola. Viene en orden cronológico y con el odómetro de cada día, que es lo que
 * permite ver cuánto dibujo se pierde por cada diez mil kilómetros.
 *
 * No se acota por sucursal: la gracia de esto es seguir a la pieza cuando se va
 * a otro patio, y cortarla por la sucursal de hoy escondería justo la mitad de
 * su historia que explica cómo llegó así.
 */
export async function unidadDesgaste(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'lector', 'responsable')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    return { status: 200, jsonBody: { data: await repo.historialDesgasteUnidad(id) } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('unidad-desgaste', {
  methods: ['GET'],
  route: 'unidades/{id}/desgaste',
  authLevel: 'anonymous',
  handler: unidadDesgaste,
})
