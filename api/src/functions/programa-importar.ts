// Alta de un programa completo desde la tabla del fabricante en CSV. El
// navegador lee el archivo y manda la cuadrícula armada; aquí se valida y se
// guarda de una sola vez. Ver `docs/importar-programa.md`.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import * as service from '../services/programaService'
import { ProgramaImportarSchema } from '../schemas/programaSchema'

export async function programaImportar(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    // Los mismos que pueden capturarlo a mano: importar es transcribir el
    // manual sin teclearlo.
    const user = requireRole(req, 'admin', 'editor', 'practicante')
    const modeloId = parseInt(req.params.modeloId, 10)
    if (isNaN(modeloId)) return { status: 400, jsonBody: { error: 'ID de modelo inválido' } }
    const body = ProgramaImportarSchema.parse(await req.json())
    const created = await service.importar(modeloId, body)
    await audit({
      user,
      accion: 'CREAR',
      tabla: 'programas_mantenimiento',
      registroId: created.id,
      despues: await capturar('programas_mantenimiento', created.id),
      detalles: {
        importado: true,
        fases: body.fases.length,
        operaciones: body.operaciones.length,
      },
      ipAddress: getClientIp(req),
    })
    return { status: 201, jsonBody: { data: created } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('programa-importar', {
  methods: ['POST'],
  route: 'modelos/{modeloId}/programa/importar',
  authLevel: 'anonymous',
  handler: programaImportar,
})
