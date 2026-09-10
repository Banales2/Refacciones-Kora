import * as repo from '../repositories/descuadresRepo'
import type { Descuadre, ResolucionDescuadre } from '../repositories/descuadresRepo'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getAbiertos(sucursalId?: number): Promise<Descuadre[]> {
  return repo.findAbiertos(sucursalId)
}

/**
 * Cierra un descuadre, de una de las dos formas que tiene sentido cerrarlo:
 * se ajustó la existencia, o se contó el estante y no había nada que ajustar.
 *
 * Un descuadre ya cerrado no se vuelve a cerrar. No es una carrera improbable:
 * son dos personas mirando la misma lista, y la segunda pisaría el conteo de la
 * primera sin enterarse de que ya lo habían resuelto.
 */
export async function resolver(
  id: number, status: ResolucionDescuadre, nota: string | null, usuario: string,
): Promise<Descuadre> {
  const actual = await repo.findById(id)
  if (!actual) throw new NotFoundError('Descuadre')
  if (actual.status !== 'abierto') {
    throw new ConflictError(
      `Ese descuadre ya lo cerró ${actual.resuelto_por ?? 'alguien más'}. Recarga la lista.`
    )
  }

  const ok = await repo.resolver(id, status, nota, usuario)
  // Perdió la carrera entre el SELECT y el UPDATE: alguien lo cerró en medio.
  if (!ok) throw new ConflictError('Ese descuadre acaba de cerrarlo alguien más. Recarga la lista.')

  const cerrado = await repo.findById(id)
  if (!cerrado) throw new NotFoundError('Descuadre')
  return cerrado
}
