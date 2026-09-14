import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import * as service from '../services/modelosService'

export async function modelosList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    requireRole(req, 'admin', 'editor', 'viewer')
    // ?descontinuados=1 los incluye. Solo lo pide la pantalla de modelos, para
    // poder verlos y revivirlos; los selectores del alta usan la lista normal,
    // que ya los deja fuera.
    const data = await service.getAll(req.query.get('descontinuados') === '1')
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('modelos-list', { methods: ['GET'], route: 'modelos', authLevel: 'anonymous', handler: modelosList })
