import * as repo from '../repositories/solicitudesRepo'
import * as sucursalesRepo from '../repositories/sucursalesRepo'
import type { SolicitudCreate, SolicitudResolver } from '../schemas/solicitudSchema'
import { NotFoundError, ValidationError, ConflictError } from '../shared/errors'
import { Alcance, SIN_ACOTAR, sucursalPermitida } from '../shared/alcance'
import { fechaMexico } from '../shared/fechaMexico'

export async function getAll(alcance: Alcance, estado?: repo.EstadoSolicitud) {
  return repo.findAll(alcance, estado)
}

export async function getById(id: number, alcance: Alcance) {
  const solicitud = await repo.findById(id)
  if (!solicitud) throw new NotFoundError('Solicitud')
  // Fuera del alcance contesta 404 y no 403: decir "existe pero no es tuya" ya
  // es enseñar algo de otra sucursal. Mismo criterio que `exigirVehiculo`.
  if (alcance.sucursalId != null && solicitud.sucursal_id !== alcance.sucursalId) {
    throw new NotFoundError('Solicitud')
  }
  return solicitud
}

export async function contarPendientes(alcance: Alcance = SIN_ACOTAR) {
  return repo.contarPendientes(alcance)
}

/**
 * Levanta una solicitud.
 *
 * La sucursal de destino se decide aquí y no en el cliente: a quien está
 * acotado a un patio se le pone el suyo y no se le pregunta, porque pedir para
 * otra sucursal no es algo que deba poder hacer por accidente.
 * `sucursalPermitida` ya impone las dos mitades de esa regla —le devuelve la
 * suya cuando no manda ninguna, y rechaza la ajena—.
 */
export async function create(
  data: SolicitudCreate, solicitadoPor: string, alcance: Alcance,
) {
  const sucursalId = sucursalPermitida(data.sucursal_id, alcance)
  if (sucursalId == null) {
    throw new ValidationError('Elige la sucursal a la que va la refacción')
  }
  const sucursal = await sucursalesRepo.findById(sucursalId)
  if (!sucursal) throw new NotFoundError('Sucursal')

  // Se valida contra el catálogo para poder decir cuál falta: dejar que
  // reviente la llave foránea daría un 500 sin nombre.
  const faltan = await repo.piezasInexistentes(data.renglones.map((r) => r.pieza_id))
  if (faltan.length > 0) {
    throw new NotFoundError('Refacción')
  }

  return repo.create({
    sucursal_id: sucursalId,
    motivo:      data.motivo,
    fecha:       fechaMexico(),
    renglones:   data.renglones,
  }, solicitadoPor)
}

/**
 * Contesta la solicitud: sí o no, y queda firmado.
 *
 * Aprobar NO la cierra. La pieza todavía no está en el patio, y confundir las
 * dos cosas es lo que hace que una autorización que nadie surtió desaparezca de
 * la lista sin que nadie note que la refacción nunca llegó.
 */
export async function resolver(
  id: number, data: SolicitudResolver, resueltoPor: string,
) {
  const actual = await repo.findById(id)
  if (!actual) throw new NotFoundError('Solicitud')
  if (actual.estado !== 'pendiente') {
    throw new ConflictError(
      `Esta solicitud ya la contestó ${actual.resuelto_por}: quedó como ${actual.estado}.`
    )
  }

  const resuelta = await repo.resolver(id, data.estado, resueltoPor, data.nota?.trim() || null)
  // Null significa que entre la lectura de arriba y el UPDATE alguien más la
  // contestó. Es la misma situación, contada por la carrera.
  if (!resuelta) throw new ConflictError('Alguien más contestó esta solicitud hace un momento.')
  return resuelta
}

/** La refacción llegó al patio. */
export async function surtir(id: number, surtidoPor: string) {
  const actual = await repo.findById(id)
  if (!actual) throw new NotFoundError('Solicitud')
  if (actual.estado === 'surtida') {
    throw new ConflictError(`Esta solicitud ya la surtió ${actual.surtido_por}.`)
  }
  if (actual.estado !== 'aprobada') {
    throw new ValidationError(
      actual.estado === 'pendiente'
        ? 'Esta solicitud todavía no se aprueba: apruébala antes de surtirla.'
        : 'Esta solicitud se rechazó, así que no hay nada que surtir.'
    )
  }

  const surtida = await repo.surtir(id, surtidoPor)
  if (!surtida) throw new ConflictError('Alguien más la surtió hace un momento.')
  return surtida
}
