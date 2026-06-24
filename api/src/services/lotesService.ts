import * as repo from '../repositories/lotesRepo'
import { LoteConProveedor } from '../types/domain'
import { LoteCreate, LoteUpdate } from '../schemas/loteSchema'
import { NotFoundError, ValidationError } from '../shared/errors'

export async function createLote(piezaId: number, data: LoteCreate): Promise<LoteConProveedor> {
  return repo.create(piezaId, data)
}

export async function updateLote(id: number, data: LoteUpdate): Promise<LoteConProveedor> {
  let newCantidadDisponible: number | undefined

  if (data.cantidad_inicial !== undefined) {
    const raw = await repo.getRaw(id)
    if (!raw) throw new NotFoundError('Lote')
    const vendidas = raw.cantidad_inicial - raw.cantidad_disponible
    newCantidadDisponible = data.cantidad_inicial - vendidas
    if (newCantidadDisponible < 0) {
      throw new ValidationError(
        `No se puede reducir la cantidad inicial a ${data.cantidad_inicial}: ya se usaron ${vendidas} unidades`
      )
    }
  }

  const result = await repo.update(id, data, newCantidadDisponible)
  if (!result) throw new NotFoundError('Lote')
  return result
}

export async function deleteLote(id: number): Promise<void> {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Lote')
}

export async function getProveedores(): Promise<{ id: number; nombre: string }[]> {
  return repo.findProveedores()
}
