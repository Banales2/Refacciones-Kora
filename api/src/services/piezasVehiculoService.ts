import * as repo from '../repositories/piezasVehiculoRepo'
import type { PiezaDeVehiculo, DatosMontaje, InstalacionHistorial } from '../repositories/piezasVehiculoRepo'
import * as vehiculosRepo from '../repositories/vehiculosRepo'
import * as refaccionesRepo from '../repositories/refaccionesRepo'
import * as lotesRepo from '../repositories/lotesRepo'
import * as tiposRepo from '../repositories/tiposPiezaRepo'
import { NotFoundError, ValidationError } from '../shared/errors'
import { fechaMexico } from '../shared/fechaMexico'

export async function getByVehiculo(vehiculoId: number): Promise<PiezaDeVehiculo[]> {
  const vehiculo = await vehiculosRepo.findById(vehiculoId)
  if (!vehiculo) throw new NotFoundError('Vehículo')
  return repo.findByVehiculo(vehiculoId)
}

export async function getHistorial(vehiculoId: number): Promise<InstalacionHistorial[]> {
  const vehiculo = await vehiculosRepo.findById(vehiculoId)
  if (!vehiculo) throw new NotFoundError('Vehículo')
  return repo.findHistorial(vehiculoId)
}

export async function setPieza(
  vehiculoId: number, tipoId: number, piezaId: number, datos: DatosMontaje = {},
): Promise<void> {
  const vehiculo = await vehiculosRepo.findById(vehiculoId)
  if (!vehiculo) throw new NotFoundError('Vehículo')

  const tipo = await tiposRepo.findById(tipoId)
  if (!tipo) throw new NotFoundError('Tipo de pieza')

  if (!(await repo.vehiculoRequiereTipo(vehiculoId, tipoId))) {
    throw new ValidationError(`Este vehículo no requiere ${tipo.nombre}`)
  }

  const pieza = await refaccionesRepo.findById(piezaId)
  if (!pieza) throw new NotFoundError('Refacción')

  // La pieza tiene que ser de ese tipo: si no, la elección del vehículo no
  // responde a lo que el modelo pide.
  if (pieza.tipo_pieza_id !== tipoId) {
    throw new ValidationError(
      `La refacción ${pieza.numero_serie} no es de tipo ${tipo.nombre}. ` +
      'Ajusta el tipo de la refacción en el catálogo o elige otra.'
    )
  }

  // El lote es opcional, pero si viene tiene que ser de esta pieza: si no, la
  // trazabilidad apuntaría a una compra que no es la de lo que se montó, que es
  // peor que no tener trazabilidad.
  if (datos.lote_id != null) {
    const lote = await lotesRepo.findById(datos.lote_id)
    if (!lote) throw new NotFoundError('Lote')
    if (lote.pieza_id !== piezaId) {
      throw new ValidationError(
        `El lote seleccionado no es de la refacción ${pieza.numero_serie}.`
      )
    }
  }

  // Sin fecha explícita, hoy en México. Se resuelve aquí y no en SQL porque el
  // server corre en UTC y por la tarde ya está en el día siguiente.
  await repo.setPieza(vehiculoId, tipoId, piezaId, {
    ...datos,
    fecha_instalacion: datos.fecha_instalacion ?? fechaMexico(),
  })
}

export async function removePieza(
  vehiculoId: number, tipoId: number,
  datos: { fecha_retiro?: string; km_retiro?: number; motivo_retiro?: string; destino?: string } = {},
): Promise<void> {
  const ok = await repo.removePieza(vehiculoId, tipoId, datos)
  if (!ok) throw new NotFoundError('Pieza asignada a este vehículo')
}
