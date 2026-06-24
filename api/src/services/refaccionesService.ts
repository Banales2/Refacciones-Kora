import * as repo from '../repositories/refaccionesRepo'
import { Pieza, PiezaConCantidad, LoteConProveedor } from '../types/domain'
import { RefaccionCreate, RefaccionUpdate, SearchBy } from '../schemas/refaccionSchema'
import { NotFoundError, ConflictError } from '../shared/errors'

export async function getAll(params: {
  page: number
  pageSize: number
  search?: string
  searchBy?: SearchBy
}): Promise<{ data: PiezaConCantidad[]; total: number; page: number; pageSize: number }> {
  const offset = (params.page - 1) * params.pageSize
  const result = await repo.findAll({ offset, pageSize: params.pageSize, search: params.search, searchBy: params.searchBy })
  return { ...result, page: params.page, pageSize: params.pageSize }
}

export async function getById(id: number): Promise<Pieza> {
  const item = await repo.findById(id)
  if (!item) throw new NotFoundError('Refacción')
  return item
}

export async function getLotesByPiezaId(
  piezaId: number
): Promise<{ pieza: Pieza; lotes: LoteConProveedor[] }> {
  const pieza = await repo.findById(piezaId)
  if (!pieza) throw new NotFoundError('Pieza')
  const lotes = await repo.findLotesByPiezaId(piezaId)
  return { pieza, lotes }
}

export async function create(data: RefaccionCreate): Promise<Pieza> {
  const existing = await repo.findByNumeroSerie(data.numero_serie)
  if (existing) throw new ConflictError(`Ya existe una pieza con número de serie ${data.numero_serie}`)
  return repo.create(data)
}

export async function update(id: number, data: RefaccionUpdate): Promise<Pieza> {
  if (data.numero_serie) {
    const existing = await repo.findByNumeroSerie(data.numero_serie)
    if (existing && existing.id !== id) throw new ConflictError(`Ya existe una pieza con número de serie ${data.numero_serie}`)
  }
  const item = await repo.update(id, data)
  if (!item) throw new NotFoundError('Refacción')
  return item
}

export async function remove(id: number): Promise<void> {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Refacción')
}
