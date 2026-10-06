import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole, exigirCapturaPropia } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe } from '../shared/alcance'
import { audit, getClientIp } from '../shared/audit'
import { capturar } from '../shared/snapshot'
import { ValeGasolinaUpdateSchema } from '../schemas/valeGasolinaSchema'
import * as service from '../services/valesGasolinaService'

export async function valesGasolinaUpdate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    // El practicante también, pero solo los vales que él capturó: es para
    // arreglar su propio error de captura sin esperar a un editor.
    const user = requireRole(request, 'admin', 'editor', 'practicante')
    const id = parseInt(request.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }
    const vale = await service.getById(id)
    exigirCapturaPropia(user, vale.capturado_por)

    const data = ValeGasolinaUpdateSchema.parse(await request.json())
    const antes = await capturar('vales_gasolina', id)
    // Si el vale ya se gastó, corregirlo corrige también su recarga (chofer y
    // unidad): esa también va a la bitácora, con su propio antes y después.
    const recargaId = vale.recarga_id
    const recargaAntes = recargaId != null ? await capturar('recargas_combustible', recargaId) : null
    const updated = await service.update(id, data, (await alcanceDe(user)).sucursalId)

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'vales_gasolina',
      registroId: id,
      antes,
      despues: await capturar('vales_gasolina', id),
      ipAddress: getClientIp(request),
    })
    if (recargaId != null) {
      const recargaDespues = await capturar('recargas_combustible', recargaId)
      if (JSON.stringify(recargaAntes) !== JSON.stringify(recargaDespues)) {
        await audit({
          user,
          accion: 'EDITAR',
          tabla: 'recargas_combustible',
          registroId: recargaId,
          antes: recargaAntes,
          despues: recargaDespues,
          detalles: { por_correccion_del_vale: id },
          ipAddress: getClientIp(request),
        })
      }
    }

    return { status: 200, jsonBody: { data: updated } }
  } catch (err) {
    return handleError(err, context)
  }
}

app.http('vales-gasolina-update', {
  methods: ['PUT', 'PATCH'],
  route: 'vales-gasolina/{id}',
  authLevel: 'anonymous',
  handler: valesGasolinaUpdate,
})
