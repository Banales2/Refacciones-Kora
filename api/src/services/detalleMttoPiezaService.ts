import * as repo from '../repositories/detalleMttoPiezaRepo'
import * as mantenimientoRepo from '../repositories/mantenimientoRepo'
import * as piezasVehiculoRepo from '../repositories/piezasVehiculoRepo'
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
  // El stock se valida contra la sucursal elegida, no contra el total del lote:
  // que haya 10 piezas repartidas no significa que haya 10 en Vallarta.
  const lote = await repo.getLoteInfo(data.lote_id, data.sucursal_id)
  if (!lote) throw new NotFoundError('Lote')
  if (lote.cantidad_disponible < data.cantidad) {
    throw new ValidationError(
      `Stock insuficiente en esa sucursal: disponible ${lote.cantidad_disponible}, solicitado ${data.cantidad}`
    )
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
      if (raw.sucursal_id == null) {
        throw new ValidationError(
          'Este consumo no tiene sucursal registrada y no se puede aumentar. ' +
          'Bórralo y captúralo de nuevo indicando de qué sucursal sale.'
        )
      }
      const lote = await repo.getLoteInfo(raw.lote_id, raw.sucursal_id)
      if (!lote || lote.cantidad_disponible < cantidadDelta) {
        throw new ValidationError('Stock insuficiente en esa sucursal para aumentar la cantidad')
      }
    }
  }
  const updated = await repo.update(id, data, cantidadDelta)
  if (!updated) throw new NotFoundError('Detalle')
  return updated
}

export async function remove(id: number) {
  // Borrar el consumo devuelve su cantidad al almacén. Si esas piezas ya se
  // montaron en la unidad, devolverlas las dejaría contadas en el estante y en
  // el carro a la vez — el descuadre exacto que la migración 008 cierra. El FK
  // ya lo impide en la base; esto es para que el mensaje diga qué hacer en vez
  // de reventar con un error de constraint.
  const montadas = await piezasVehiculoRepo.countMontadasDeConsumo(id)
  if (montadas > 0) {
    throw new ValidationError(
      `Este consumo respalda ${montadas} pieza(s) montadas en la unidad. ` +
      'Quítalas del vehículo (o desliga el montaje) antes de borrar el consumo.'
    )
  }
  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Detalle')
}
