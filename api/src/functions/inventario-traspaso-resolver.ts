import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { z } from 'zod'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { audit, getClientIp } from '../shared/audit'
import { TEXTO_LIBRE } from '../schemas/common'
import * as service from '../services/inventarioService'

// La segunda mitad del traspaso (migración 035). El origen envía y la mercancía
// queda en camino; aquí es donde aterriza:
//
//   aceptar   -> entra al estante del destino.
//   rechazar  -> el destino no la recibe y vuelve al origen.
//   cancelar  -> el origen la retira antes de que nadie la acepte.
//
// Las tres son POST y no DELETE ni PATCH: la API no expone DELETE en ninguna
// ruta (ver docs/sin-delete.md), y son acciones con nombre propio, no la
// edición de un campo.
//
// Se registran desde un solo archivo porque el manejador es el mismo y lo único
// que cambia es el estado final; tres copias del bloque era la forma segura de
// que a la tercera se le olvidara la auditoría.
const Schema = z.object({
  motivo: z
    .string()
    .trim()
    .max(300, 'Máximo 300 caracteres')
    .regex(TEXTO_LIBRE, 'Contiene caracteres no permitidos')
    .optional(),
})

type Accion = 'aceptar' | 'rechazar' | 'cancelar'

const ESTADO: Record<Accion, 'aceptado' | 'rechazado' | 'cancelado'> = {
  aceptar:  'aceptado',
  rechazar: 'rechazado',
  cancelar: 'cancelado',
}

function handler(accion: Accion) {
  return async function resolverTraspaso(
    req: HttpRequest, ctx: InvocationContext,
  ): Promise<HttpResponseInit> {
    try {
      const user = requireRole(req, 'admin', 'editor')
      const id = parseInt(req.params.id, 10)
      if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

      // Aceptar no lleva motivo: no hace falta explicar que la mercancía llegó
      // como se esperaba, y un campo opcional más en el camino feliz es un campo
      // que nadie llena. En los otros dos es lo que explica el movimiento de
      // vuelta, pero tampoco se exige: frenar la devolución del stock por un
      // texto es peor que quedarse sin el texto.
      const { motivo } = Schema.parse(await req.json().catch(() => ({})))

      const traspaso = await service.resolverTraspaso(
        id, ESTADO[accion], user.userDetails, accion === 'aceptar' ? null : motivo ?? null,
      )

      await audit({
        user,
        accion: 'EDITAR',
        tabla: 'traspasos_pieza',
        registroId: id,
        detalles: {
          resolucion: ESTADO[accion],
          pieza: traspaso.numero_serie,
          de: traspaso.origen,
          a: traspaso.destino,
          cantidad: traspaso.cantidad,
          ...(traspaso.motivo_resolucion ? { motivo: traspaso.motivo_resolucion } : {}),
        },
        ipAddress: getClientIp(req),
      })

      return { status: 200, jsonBody: { data: traspaso } }
    } catch (err) { return handleError(err, ctx) }
  }
}

for (const accion of ['aceptar', 'rechazar', 'cancelar'] as const) {
  app.http(`inventario-traspaso-${accion}`, {
    methods: ['POST'],
    route: `inventario/traspasos/{id}/${accion}`,
    authLevel: 'anonymous',
    handler: handler(accion),
  })
}
