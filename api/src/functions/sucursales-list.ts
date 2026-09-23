import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe } from '../shared/alcance'
import * as service from '../services/sucursalesService'

export async function sucursalesList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'viewer', 'practicante', 'responsable')
    // ?archivados=1 los incluye. Solo lo pide la pantalla del catálogo, para poder
    // verlos y restaurarlos; los selectores del alta usan la lista normal.
    const todas = await service.getAll(req.query.get('archivados') === '1')
    // El acotado ve sólo la suya: los selectores de sucursal (patio,
    // inventario) quedan con una opción y no ofrecen lo que la API negaría.
    const { sucursalId } = await alcanceDe(user)
    const data = sucursalId == null ? todas : todas.filter((s) => s.id === sucursalId)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('sucursales-list', { methods: ['GET'], route: 'sucursales', authLevel: 'anonymous', handler: sucursalesList })
