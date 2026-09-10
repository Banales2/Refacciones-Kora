import * as repo from '../repositories/detalleMttoPiezaRepo'
import * as mantenimientoRepo from '../repositories/mantenimientoRepo'
import * as piezasVehiculoRepo from '../repositories/piezasVehiculoRepo'
import * as piezasVehiculoService from './piezasVehiculoService'
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
  const montajes = data.montajes ?? []
  // Cada montaje consume una de las piezas del renglón. `setPieza` lo verifica
  // otra vez contra las ya ligadas, pero aquí el mensaje puede decir cuántas se
  // capturaron y cuántas caben, que es lo que el usuario tiene enfrente.
  if (montajes.length > data.cantidad) {
    throw new ValidationError(
      `Se indicaron ${montajes.length} posiciones para un consumo de ${data.cantidad} pieza(s). ` +
      'Sube la cantidad o quita posiciones.'
    )
  }
  const etiquetas = montajes.map((m) => m.etiqueta)
  if (new Set(etiquetas).size !== etiquetas.length) {
    throw new ValidationError('Una misma posición aparece dos veces en este consumo.')
  }

  const costoUnitario = data.costo_unitario ?? lote.costo_unitario
  const creado = await repo.create(mantenimientoId, data, costoUnitario)
  if (montajes.length === 0) {
    return { detalle: creado, montajeError: null, montajeAviso: null }
  }

  return { detalle: creado, ...(await montar(mantenimientoId, creado, montajes)) }
}

/**
 * Monta en la unidad las piezas del consumo recién capturado.
 *
 * Va DESPUÉS de crear el consumo y fuera de su transacción, a propósito. El
 * consumo es válido por sí solo —el gasto ocurrió— y lo que puede fallar aquí
 * son cosas del vehículo, no del gasto: que la unidad no pida ese renglón, que
 * el tipo de la refacción no cuadre. Tirar el consumo por eso obligaría a
 * recapturarlo entero; en vez de eso se devuelve el aviso y la pieza queda como
 * "sin montar", que es exactamente lo que era antes de todo esto y se resuelve
 * desde el propio detalle.
 *
 * Devuelve dos avisos distintos y por eso no son uno solo: `montajeError` es lo
 * que NO se pudo montar y hay que resolver; `montajeAviso` es lo que SÍ se
 * montó pero quedó en el historial, sin reemplazar la pieza vigente, porque
 * este servicio es anterior al último cambio de ese renglón. Mezclarlos
 * mandaría a arreglar algo que ya está bien.
 */
async function montar(
  mantenimientoId: number,
  consumo: repo.DetalleMttoPieza,
  montajes: NonNullable<DetalleMttoPiezaCreate['montajes']>,
): Promise<{ montajeError: string | null; montajeAviso: string | null }> {
  if (consumo.tipo_pieza_id == null) {
    return {
      montajeError:
        `${consumo.numero_serie} no tiene tipo de pieza, así que no se puede montar en la unidad. ` +
        'Asígnale uno en el catálogo de refacciones.',
      montajeAviso: null,
    }
  }
  const mantenimiento = await mantenimientoRepo.findById(mantenimientoId)
  if (!mantenimiento) throw new NotFoundError('Mantenimiento')

  // `fecha` está tipada como string porque así viaja en el JSON, pero aquí
  // todavía no ha pasado por la serialización: el driver entrega las columnas
  // `date` como Date, y un `.slice()` directo revienta. Llega como medianoche
  // UTC, así que la parte de fecha del ISO es el día del calendario correcto.
  const fechaServicio = mantenimiento.fecha
    ? new Date(mantenimiento.fecha).toISOString().slice(0, 10)
    : undefined

  const fallos: string[] = []
  // Los que se guardaron en el historial sin reemplazar la pieza actual.
  const historicos: string[] = []
  for (const m of montajes) {
    try {
      const res = await piezasVehiculoService.setPieza(
        mantenimiento.vehiculo_id, consumo.tipo_pieza_id, m.etiqueta, consumo.pieza_id,
        {
          // La liga: el consumo ya descontó del almacén, así que montar no
          // vuelve a moverlo.
          detalle_mtto_pieza_id: consumo.id,
          mantenimiento_id:      mantenimientoId,
          // La instalación es el día del servicio, no el de la captura.
          fecha_instalacion:     fechaServicio,
          km_instalacion:        mantenimiento.km_actual || undefined,
          motivo_retiro:         m.motivo_retiro ?? undefined,
          destino:               m.destino ?? undefined,
          km_retiro:             mantenimiento.km_actual || undefined,
        },
      )
      if (res.historico) {
        const donde = m.etiqueta ? `"${m.etiqueta}"` : 'la posición única'
        historicos.push(
          `${donde} (esa posición se volvió a cambiar el ${res.vigenteDesde})`
        )
      }
    } catch (err) {
      const donde = m.etiqueta ? `"${m.etiqueta}"` : 'la posición única'
      fallos.push(`${donde}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return {
    montajeError: fallos.length
      ? `El consumo se guardó, pero no se pudo montar en ${fallos.join('; ')}`
      : null,
    montajeAviso: historicos.length
      ? 'Este mantenimiento es anterior al último cambio de esa posición, así que ' +
        'la pieza quedó registrada en el historial de la unidad pero NO reemplaza a ' +
        `la que trae puesta ahora: ${historicos.join('; ')}.`
      : null,
  }
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
