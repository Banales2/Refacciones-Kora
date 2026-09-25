import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { requireRole } from '../shared/auth'
import { handleError } from '../shared/errors'
import { alcanceDe } from '../shared/alcance'
import { audit, getClientIp } from '../shared/audit'
import { nombreOCorreo } from '../shared/usuario'
import { SolicitudCreateSchema, SolicitudResolverSchema } from '../schemas/solicitudSchema'
import type { EstadoSolicitud } from '../repositories/solicitudesRepo'
import * as service from '../services/solicitudesService'

const ESTADOS = ['pendiente', 'aprobada', 'rechazada', 'surtida']

/**
 * Las solicitudes que alcanza a ver quien pregunta.
 *
 * El responsable ve las de su sucursal y nada más, y esa es la mitad del valor
 * del módulo: es lo que le permite ver que su compañero ya pidió las balatas y
 * no volver a pedirlas. El lector también las ve —son parte de la operación—
 * pero no las contesta.
 */
export async function solicitudesList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'lector', 'responsable')
    const estado = req.query.get('estado') ?? undefined
    if (estado && !ESTADOS.includes(estado)) {
      return { status: 400, jsonBody: { error: 'Estado inválido' } }
    }
    const data = await service.getAll(await alcanceDe(user), estado as EstadoSolicitud | undefined)
    return { status: 200, jsonBody: { data } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('solicitudes-list', {
  methods: ['GET'],
  route: 'solicitudes-refaccion',
  authLevel: 'anonymous',
  handler: solicitudesList,
})

/**
 * Levanta una solicitud. La sucursal de destino la pone el servidor cuando
 * quien pide está acotado a una.
 */
export async function solicitudCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor', 'responsable')
    const data = SolicitudCreateSchema.parse(await req.json())
    const creada = await service.create(data, await nombreOCorreo(user), await alcanceDe(user))

    await audit({
      user,
      accion: 'CREAR',
      tabla: 'solicitudes_refaccion',
      registroId: creada.id,
      detalles: {
        sucursal: creada.sucursal,
        refacciones: creada.renglones.length,
        piezas: creada.renglones.map((r) => `${r.numero_serie} x${r.cantidad}`).join(', '),
      },
      ipAddress: getClientIp(req),
    })

    return { status: 201, jsonBody: { data: creada } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('solicitud-create', {
  methods: ['POST'],
  route: 'solicitudes-refaccion',
  authLevel: 'anonymous',
  handler: solicitudCreate,
})

/**
 * Contesta la solicitud: aprobada o rechazada, y queda firmado.
 *
 * El responsable no la contesta aunque sea suya: pedir y autorizar lo que uno
 * mismo pidió es el mismo par de manos, y entonces la solicitud no sería una
 * solicitud.
 */
export async function solicitudResolver(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const data = SolicitudResolverSchema.parse(await req.json())
    const resuelta = await service.resolver(id, data, await nombreOCorreo(user))

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'solicitudes_refaccion',
      registroId: id,
      detalles: { estado: resuelta.estado, nota: resuelta.resolucion_nota },
      ipAddress: getClientIp(req),
    })

    return { status: 200, jsonBody: { data: resuelta } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('solicitud-resolver', {
  methods: ['POST'],
  route: 'solicitudes-refaccion/{id}/resolver',
  authLevel: 'anonymous',
  handler: solicitudResolver,
})

/**
 * La refacción llegó al patio.
 *
 * Lo marca quien la entrega, que es de oficina o almacén. El responsable no:
 * si él pudiera cerrarla, "ya llegó" y "yo digo que llegó" serían el mismo
 * registro.
 */
export async function solicitudSurtir(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = requireRole(req, 'admin', 'editor')
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return { status: 400, jsonBody: { error: 'ID inválido' } }

    const surtida = await service.surtir(id, await nombreOCorreo(user))

    await audit({
      user,
      accion: 'EDITAR',
      tabla: 'solicitudes_refaccion',
      registroId: id,
      detalles: { estado: 'surtida' },
      ipAddress: getClientIp(req),
    })

    return { status: 200, jsonBody: { data: surtida } }
  } catch (err) { return handleError(err, ctx) }
}

app.http('solicitud-surtir', {
  methods: ['POST'],
  route: 'solicitudes-refaccion/{id}/surtir',
  authLevel: 'anonymous',
  handler: solicitudSurtir,
})
