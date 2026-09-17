import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { ProgramaCopiarSchema } from '../schemas/programaSchema'
import * as service from '../services/programaService'

// Copiar el programa de un modelo a otro: la tabla completa —columnas,
// renglones y cada cruce—, sin el avance de las unidades, que es del vehículo y
// no del programa.
//
// POST y no PUT: no edita el programa de la ruta, crea uno nuevo en otro modelo.
export async function programaCopiar(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const data = ProgramaCopiarSchema.parse(await req.json())
    const copia = await service.copiar(id, data)

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'programas_mantenimiento',
      registroId: copia.id,
      detalles: {
        copiado_de: id,
        modelo_destino: copia.modelo_id,
        tipo: copia.tipo,
        nombre: copia.nombre,
      },
      ipAddress: getClientIp(req),
    })

    return { status: 201, jsonBody: { data: copia } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('programa-copiar', {
  methods: ['POST'],
  route: 'programa/{id}/copiar',
  authLevel: 'anonymous',
  handler: programaCopiar,
})
