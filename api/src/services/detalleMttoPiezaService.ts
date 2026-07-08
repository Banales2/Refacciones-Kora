import * as repo from '../repositories/detalleMttoPiezaRepo'
import * as mantenimientoRepo from '../repositories/mantenimientoRepo'
import { DetalleMttoPiezaCreate, DetalleMttoPiezaUpdate } from '../schemas/detalleMttoPiezaSchema'
import { NotFoundError, ValidationError } from '../shared/errors'

export async function getDetalle(mantenimientoId: number) {
  const mantenimiento = await mantenimientoRepo.findById(mantenimientoId)
  if (!mantenimiento) throw new NotFoundError('Mantenimiento')
  const detalles = await repo.findByMantenimientoId(mantenimientoId)
  return { mantenimiento, detalles }
}

export async function getLotesDisponibles() {
  return repo.findDisponibles()
}

export async function create(mantenimientoId: number, data: DetalleMttoPiezaCreate) {
  const lote = await repo.getLoteInfo(data.lote_id)
  if (!lote) throw new NotFoundError('Lote')
  if (lote.cantidad_disponible < data.cantidad) {
    throw new ValidationError(`Stock insuficiente: disponible ${lote.cantidad_disponible}, solicitado ${data.cantidad}`)
  }
  const costoUnitario = data.costo_unitario ?? lote.costo_unitario
  return repo.create(mantenimientoId, data, costoUnitario)
}

export async function update(id: number, data: DetalleMttoPiezaUpdate) {
  let cantidadDelta = 0
  if (data.cantidad !== undefined) {
    const raw = await repo.getRaw(id)
    if (!raw) throw new NotFoundError('Detalle')
    cantidadDelta = data.cantidad - raw.cantidad
    if (cantidadDelta > 0) {
      const lote = await repo.getLoteInfo(raw.lote_id)
      if (!lote || lote.cantidad_disponible < cantidadDelta) {
        throw new ValidationError('Stock insuficiente para aumentar la cantidad')
      }
    }
  }
  const updated = await repo.update(id, data, cantidadDelta)
  if (!updated) throw new NotFoundError('Detalle')
  return updated
}

export async function remove(id: number) {
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Detalle')
}
