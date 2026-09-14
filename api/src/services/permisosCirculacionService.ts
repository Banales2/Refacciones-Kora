import * as repo from '../repositories/permisosCirculacionRepo'
import type { PermisoCirculacion } from '../repositories/permisosCirculacionRepo'
import type { PermisoCirculacionCreate, PermisoCirculacionUpdate } from '../schemas/permisoCirculacionSchema'
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors'
import { fechaMexico } from '../shared/fechaMexico'

export async function getAll(): Promise<PermisoCirculacion[]> {
  return repo.findAll()
}

export async function create(data: PermisoCirculacionCreate): Promise<PermisoCirculacion> {
  if (await repo.existsMismaZonaYFecha(data.zona_circulacion, data.fecha_emision)) {
    throw new ConflictError('Ya existe un permiso de esa zona emitido en esa fecha')
  }
  return repo.create(data.zona_circulacion, data.fecha_emision, data.fecha_expiracion)
}

export async function update(id: number, data: PermisoCirculacionUpdate): Promise<PermisoCirculacion> {
  const actual = await repo.findById(id)
  if (!actual) throw new NotFoundError('Permiso de circulación')

  // Valores efectivos tras el update (los no enviados conservan el actual).
  const zona    = data.zona_circulacion ?? actual.zona_circulacion
  const emision = data.fecha_emision !== undefined ? data.fecha_emision : actual.fecha_emision
  if (emision && await repo.existsMismaZonaYFecha(zona, emision, id)) {
    throw new ConflictError('Ya existe un permiso de esa zona emitido en esa fecha')
  }

  const result = await repo.update(id, data.zona_circulacion, data.fecha_emision, data.fecha_expiracion)
  if (!result) throw new NotFoundError('Permiso de circulación')
  return result
}

/**
 * Dar por terminado un permiso (o revivirlo). Es lo que sustituye al borrado:
 * el permiso se queda como registro de hasta cuándo la unidad estuvo en regla,
 * pero deja de pedir una renovación que ya no va a llegar.
 *
 * SOLO SE TERMINAN LOS VENCIDOS, igual que las pólizas: archivar uno vigente no
 * arreglaría nada, solo escondería el aviso de renovarlo. Si se canceló antes de
 * tiempo, lo que corresponde es corregirle la fecha de expiración —eso es lo que
 * pasó— y entonces terminarlo.
 *
 * No toca las unidades asignadas a propósito: que sigan ahí es lo que permite
 * saber con qué permiso circularon por última vez.
 */
export async function terminar(id: number, terminado: boolean): Promise<PermisoCirculacion> {
  const permiso = await repo.findById(id)
  if (!permiso) throw new NotFoundError('Permiso de circulación')

  if (terminado && permiso.fecha_expiracion >= fechaMexico()) {
    throw new ValidationError(
      `Este permiso sigue vigente (vence el ${permiso.fecha_expiracion}): terminarlo ` +
      'solo escondería el aviso de renovarlo. Se terminan los que ya vencieron.'
    )
  }

  const result = await repo.setTerminado(id, terminado)
  if (!result) throw new NotFoundError('Permiso de circulación')
  return result
}

export async function assignVehiculos(id: number, vehiculoIds: number[]): Promise<void> {
  const permiso = await repo.findById(id)
  if (!permiso) throw new NotFoundError('Permiso de circulación')
  await repo.assignVehiculos(id, vehiculoIds)
}

export async function unassignVehiculo(id: number, vehiculoId: number): Promise<void> {
  const ok = await repo.unassignVehiculo(id, vehiculoId)
  if (!ok) throw new NotFoundError('Vehículo en este permiso')
}
