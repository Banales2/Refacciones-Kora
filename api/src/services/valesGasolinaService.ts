import * as repo from '../repositories/valesGasolinaRepo'
import type { ValeGasolina } from '../repositories/valesGasolinaRepo'
import type { ValeGasolinaCreate, ValeGasolinaUpdate } from '../schemas/valeGasolinaSchema'
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors'
import * as archivadoRepo from '../repositories/archivadoRepo'

// Chofer y vehículo se validan aquí para devolver un 404 con mensaje claro en
// vez de dejar que reviente la restricción de llave foránea con un 500.
async function validarReferencias(
  conductorId?: number, vehiculoId?: number, sucursalId?: number
): Promise<void> {
  if (sucursalId !== undefined && !(await repo.sucursalExists(sucursalId))) {
    throw new NotFoundError('Sucursal')
  }
  if (conductorId !== undefined && !(await repo.conductorExists(conductorId))) {
    throw new NotFoundError('Chofer')
  }
  if (vehiculoId !== undefined && !(await repo.vehiculoExists(vehiculoId))) {
    throw new NotFoundError('Vehículo')
  }
}

/** Cuentas a cuyo nombre puede registrar un vale quien captura. */
export async function getCuentas(sucursalUsuario: number | null): Promise<repo.CuentaVale[]> {
  return repo.findCuentas(sucursalUsuario)
}

// A nombre de quién queda el vale. Sin elegir, o eligiéndose a sí mismo, es
// quien tiene la sesión. Si eligió a otra cuenta, tiene que ser una de las que
// se le ofrecen: un texto libre dejaría registrar vales a nombre de cualquiera,
// y el correo se toma tal como está en `usuarios` para que los vales de una
// persona no queden repartidos entre dos grafías del mismo correo.
async function resolverCreador(
  elegido: string | undefined, usuarioSesion: string, sucursalUsuario: number | null,
): Promise<string> {
  if (!elegido || elegido.toLowerCase() === usuarioSesion.toLowerCase()) return usuarioSesion
  const cuenta = (await repo.findCuentas(sucursalUsuario))
    .find((c) => c.email.trim().toLowerCase() === elegido.toLowerCase())
  if (!cuenta) {
    throw new ValidationError('Esa cuenta no puede registrar vales, o no es de tu sucursal')
  }
  return cuenta.email.trim()
}

export async function getAll(incluirArchivados = false): Promise<ValeGasolina[]> {
  return repo.findAll(incluirArchivados)
}

/**
 * Dar un vale por perdido.
 *
 * No borra ni inventa nada: el vale se queda entero y su folio se sigue
 * resolviendo. Lo que cambia es que deja de contarse entre los que hay que
 * perseguir y deja de ofrecerse al capturar una recarga.
 *
 * Un vale ya usado no se archiva: ese papel no se perdió, se gastó, y
 * archivarlo escondería la recarga que cuelga de él.
 */
export async function archivar(id: number, motivo: string | null): Promise<void> {
  const vale = await repo.findById(id)
  if (!vale) throw new NotFoundError('Vale')
  if (vale.estado === 'usado') {
    throw new ConflictError(
      `El vale ${vale.folio} ya se usó en una recarga, así que no se perdió. ` +
      'Los vales que se archivan son los que nadie va a poder entregar.'
    )
  }
  if (!(await archivadoRepo.archivar('vales_gasolina', id, motivo))) {
    throw new ConflictError(`El vale ${vale.folio} ya estaba archivado`)
  }
}

/** Apareció. Vuelve a la lista y se puede volver a gastar. */
export async function restaurar(id: number): Promise<void> {
  const vale = await repo.findById(id)
  if (!vale) throw new NotFoundError('Vale')
  if (!(await archivadoRepo.restaurar('vales_gasolina', id))) {
    throw new ConflictError(`El vale ${vale.folio} no estaba archivado`)
  }
}

/**
 * `sucursalUsuario`: la sucursal a la que está acotado quien captura. Si tiene
 * una, el vale se entrega ahí y no la elige —lo que mande el cliente se
 * ignora—; si no la tiene (ve todas), tiene que decir cuál.
 */
export async function create(
  data: ValeGasolinaCreate, usuarioSesion: string, sucursalUsuario: number | null
): Promise<ValeGasolina> {
  const sucursalId = sucursalUsuario ?? data.sucursal_id
  if (sucursalId === undefined) throw new ValidationError('Sucursal requerida')
  const creadoPor = await resolverCreador(data.creado_por, usuarioSesion, sucursalUsuario)
  await validarReferencias(data.conductor_id, data.vehiculo_id, sucursalId)
  // El folio también lo protege un índice único; se revisa aquí para contestar
  // con un mensaje que diga qué pasó en vez de un error de base de datos.
  if (await repo.existsFolio(data.folio)) {
    throw new ConflictError(`Ya existe un vale con el folio ${data.folio}`)
  }
  return repo.create(data, creadoPor, sucursalId)
}

export async function update(
  id: number, data: ValeGasolinaUpdate, sucursalUsuario: number | null
): Promise<ValeGasolina> {
  // Quien está acotado a una sucursal no puede mandar un vale a otra.
  if (sucursalUsuario != null && data.sucursal_id !== undefined && data.sucursal_id !== sucursalUsuario) {
    throw new ValidationError('Solo puedes asignar vales a tu sucursal')
  }
  await validarReferencias(data.conductor_id, data.vehiculo_id, data.sucursal_id)
  if (data.folio !== undefined && await repo.existsFolio(data.folio, id)) {
    throw new ConflictError(`Ya existe un vale con el folio ${data.folio}`)
  }
  const result = await repo.update(id, data)
  if (!result) throw new NotFoundError('Vale')
  return result
}

