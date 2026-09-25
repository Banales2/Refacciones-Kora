import * as repo from '../repositories/valesGasolinaRepo'
import type { ValeGasolina } from '../repositories/valesGasolinaRepo'
import type { ValeGasolinaCreate, ValeGasolinaUpdate } from '../schemas/valeGasolinaSchema'
import { NotFoundError, ConflictError } from '../shared/errors'
import * as archivadoRepo from '../repositories/archivadoRepo'

// Chofer y vehículo se validan aquí para devolver un 404 con mensaje claro en
// vez de dejar que reviente la restricción de llave foránea con un 500.
async function validarReferencias(
  conductorId?: number, vehiculoId?: number
): Promise<void> {
  if (conductorId !== undefined && !(await repo.conductorExists(conductorId))) {
    throw new NotFoundError('Chofer')
  }
  if (vehiculoId !== undefined && !(await repo.vehiculoExists(vehiculoId))) {
    throw new NotFoundError('Vehículo')
  }
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

export async function create(data: ValeGasolinaCreate, creadoPor: string): Promise<ValeGasolina> {
  await validarReferencias(data.conductor_id, data.vehiculo_id)
  // El folio también lo protege un índice único; se revisa aquí para contestar
  // con un mensaje que diga qué pasó en vez de un error de base de datos.
  if (await repo.existsFolio(data.folio)) {
    throw new ConflictError(`Ya existe un vale con el folio ${data.folio}`)
  }
  return repo.create(data, creadoPor)
}

export async function update(id: number, data: ValeGasolinaUpdate): Promise<ValeGasolina> {
  await validarReferencias(data.conductor_id, data.vehiculo_id)
  if (data.folio !== undefined && await repo.existsFolio(data.folio, id)) {
    throw new ConflictError(`Ya existe un vale con el folio ${data.folio}`)
  }
  const result = await repo.update(id, data)
  if (!result) throw new NotFoundError('Vale')
  return result
}

