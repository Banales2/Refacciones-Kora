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
  vehiculoId: number, tipoId: number, etiqueta: string, piezaId: number,
  datosEntrada: DatosMontaje = {},
): Promise<void> {
  let datos = datosEntrada
  const vehiculo = await vehiculosRepo.findById(vehiculoId)
  if (!vehiculo) throw new NotFoundError('Vehículo')

  const tipo = await tiposRepo.findById(tipoId)
  if (!tipo) throw new NotFoundError('Tipo de pieza')

  // Se pregunta por el renglón completo (tipo + etiqueta): montar en una
  // posición que nadie pidió dejaría una pieza fuera de la lista del vehículo.
  if (!(await repo.vehiculoRequiereTipo(vehiculoId, tipoId, etiqueta))) {
    throw new ValidationError(
      `Este vehículo no requiere ${tipo.nombre}${etiqueta ? ` (${etiqueta})` : ''}`
    )
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

  // De dónde sale la unidad que se monta. Son tres caminos excluyentes, y de
  // cuál se tome depende que el almacén se descuente o no:
  //
  //   ligada a un consumo -> el mantenimiento ya la descontó. No se descuenta.
  //   lote + sucursal     -> sale del almacén ahora. Se descuenta 1.
  //   ni una ni otra      -> captura retroactiva. No se descuenta.
  //
  // Todo lo que sigue es para que el primer caso no se pueda falsificar: una
  // liga inválida sería una pieza montada que nunca se descontó de ningún lado.
  if (datos.detalle_mtto_pieza_id != null) {
    const consumo = await repo.findConsumoParaLigar(datos.detalle_mtto_pieza_id)
    if (!consumo) throw new NotFoundError('Consumo de mantenimiento')

    if (consumo.vehiculo_id !== vehiculoId) {
      throw new ValidationError(
        'Ese consumo pertenece al mantenimiento de otra unidad. ' +
        'Si la pieza terminó en esta, corrige el consumo en su mantenimiento.'
      )
    }
    if (consumo.pieza_id !== piezaId) {
      throw new ValidationError(
        `Ese consumo no es de la refacción ${pieza.numero_serie}.`
      )
    }
    // El cupo es lo que impide que un consumo de 1 pieza respalde tres
    // montajes: a partir del segundo habría piezas montadas que nadie descontó.
    if (consumo.ya_montadas >= consumo.cantidad) {
      throw new ValidationError(
        `Ese consumo ya tiene sus ${consumo.cantidad} pieza(s) montadas. ` +
        'Si montas otra, captúrala como salida del almacén o aumenta la cantidad del consumo.'
      )
    }
    // El lote del montaje y el del consumo tienen que ser el mismo: si no, la
    // unidad descontada y la montada serían de compras distintas.
    if (datos.lote_id != null && datos.lote_id !== consumo.lote_id) {
      throw new ValidationError(
        'El lote elegido no es el del consumo al que lo estás ligando.'
      )
    }
    // Se normaliza a lo que dice el consumo: es la fuente de verdad de qué
    // unidad se descontó y de dónde.
    datos = {
      ...datos,
      lote_id:          consumo.lote_id,
      sucursal_id:      consumo.sucursal_id,
      mantenimiento_id: datos.mantenimiento_id ?? consumo.mantenimiento_id,
    }
  } else if (datos.sucursal_id != null) {
    if (datos.lote_id == null) {
      throw new ValidationError(
        'Para descontar del almacén hace falta el lote del que sale la pieza.'
      )
    }
    // Solo cuando de verdad va a haber un descuento. Reasignar la misma pieza
    // es una corrección de datos y no mueve inventario, así que tampoco tiene
    // que pelearse con el stock.
    const yaPuesta = await repo.piezaVigente(vehiculoId, tipoId, etiqueta)
    if (yaPuesta !== piezaId) {
      const quedan = await repo.disponibleDeLoteEnSucursal(datos.lote_id, datos.sucursal_id)
      if (quedan < 1) {
        throw new ValidationError(
          'Ese lote ya no tiene existencias en esa sucursal. ' +
          'Elige otra sucursal, o monta la pieza sin descontar si ya había salido del almacén.'
        )
      }
    }
  }

  // Sin fecha explícita, hoy en México. Se resuelve aquí y no en SQL porque el
  // server corre en UTC y por la tarde ya está en el día siguiente.
  await repo.setPieza(vehiculoId, tipoId, etiqueta, piezaId, {
    ...datos,
    fecha_instalacion: datos.fecha_instalacion ?? fechaMexico(),
  })
}

export async function removePieza(
  vehiculoId: number, tipoId: number, etiqueta: string,
  datos: { fecha_retiro?: string; km_retiro?: number; motivo_retiro?: string; destino?: string } = {},
): Promise<void> {
  const ok = await repo.removePieza(vehiculoId, tipoId, etiqueta, datos)
  if (!ok) throw new NotFoundError('Pieza asignada a este vehículo')
}

// Piezas ya descontadas en un mantenimiento de esta unidad que siguen sin
// montarse. Es lo que el modal de montaje ofrece ligar para no descontar dos
// veces la misma unidad.
export async function getConsumosSinMontar(vehiculoId: number, piezaId: number) {
  const vehiculo = await vehiculosRepo.findById(vehiculoId)
  if (!vehiculo) throw new NotFoundError('Vehículo')
  return repo.findConsumosSinMontar(vehiculoId, piezaId)
}
