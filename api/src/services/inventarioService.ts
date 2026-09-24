import * as repo from '../repositories/inventarioRepo'
import * as sucursalesRepo from '../repositories/sucursalesRepo'
import * as refaccionesRepo from '../repositories/refaccionesRepo'
import { TraspasoCreate, MinimoCreate, MinimoUpdate } from '../schemas/inventarioSchema'
import { NotFoundError, ValidationError, ConflictError } from '../shared/errors'
import { type Alcance, sucursalPermitida } from '../shared/alcance'
import { AuthError } from '../shared/auth'
import { exigirLoteLlegado } from './lotesDisponibles'

async function exigirSucursal(id: number) {
  const s = await sucursalesRepo.findById(id)
  if (!s) throw new NotFoundError('Sucursal')
  return s
}

export async function getExistencias(sucursalId?: number) {
  if (sucursalId !== undefined) await exigirSucursal(sucursalId)
  return repo.findExistencias(sucursalId)
}

export async function getResumen(sucursalId: number) {
  await exigirSucursal(sucursalId)
  return repo.findResumen(sucursalId)
}

// ---------------------------------------------------------------------------
// Traspasos
// ---------------------------------------------------------------------------

export async function getTraspasos(sucursalId?: number) {
  if (sucursalId !== undefined) await exigirSucursal(sucursalId)
  return repo.findTraspasos(sucursalId)
}

export async function getAutorizadores(alcance: Alcance) {
  return repo.findAutorizadores(alcance)
}

export async function createTraspaso(data: TraspasoCreate, usuarioEmail: string, alcance: Alcance) {
  // Quien está acotado a una sucursal sólo envía lo que hay en la suya: mandar
  // stock de otro almacén sería disponer de algo que no está a su cargo. El
  // destino es libre, que es el sentido de un traspaso.
  sucursalPermitida(data.origen_sucursal_id, alcance)
  const origen  = await exigirSucursal(data.origen_sucursal_id)
  await exigirSucursal(data.destino_sucursal_id)

  // Mandar a otra sucursal algo que todavía no llegó a esta es prometer
  // mercancía que no se tiene. Va antes que la existencia porque `getExistencia`
  // ya no cuenta lo que no ha llegado y diría "solo hay 0", que es engañoso.
  await exigirLoteLlegado(data.lote_id)

  // Se valida contra la existencia real del lote en el origen. La base tiene su
  // propio CHECK de no-negativo por si dos capturas simultáneas pasan las dos
  // esta comprobación: ahí la segunda transacción falla en lugar de dejar la
  // sucursal debiendo piezas.
  const disponible = await repo.getExistencia(data.lote_id, data.origen_sucursal_id)
  if (disponible < data.cantidad) {
    throw new ValidationError(
      `En ${origen.nombre} solo hay ${disponible} pieza(s) de este lote, ` +
      `no se pueden traspasar ${data.cantidad}.`
    )
  }

  return repo.createTraspaso(data, usuarioEmail)
}

/**
 * Resolver un traspaso pendiente: el destino lo acepta o lo rechaza, o el origen
 * lo cancela.
 *
 * Quien ve toda la flota puede resolver cualquiera. Quien está acotado a una
 * sucursal (shared/alcance.ts) sólo resuelve desde su lado: acepta o rechaza lo
 * que llega a la suya y cancela lo que salió de ella. Un traspaso entre otras
 * dos sucursales le contesta 404, como todo lo ajeno.
 */
export async function resolverTraspaso(
  id: number, estado: 'aceptado' | 'rechazado' | 'cancelado',
  usuarioEmail: string, motivo: string | null, alcance: Alcance,
) {
  const traspaso = await repo.findTraspasoById(id)
  if (!traspaso) throw new NotFoundError('Traspaso')

  const suc = alcance.sucursalId
  if (suc != null) {
    const esOrigen  = traspaso.origen_sucursal_id  === suc
    const esDestino = traspaso.destino_sucursal_id === suc
    if (!esOrigen && !esDestino) throw new NotFoundError('Traspaso')
    // 403 y no 404: el traspaso es suyo y lo está viendo en su pantalla; lo que
    // no le toca es esta acción, y el mensaje le dice quién sí puede.
    if (estado === 'cancelado' && !esOrigen) {
      throw new AuthError('Solo la sucursal que lo envió puede cancelarlo; tú puedes aceptarlo o rechazarlo.', 403)
    }
    if (estado !== 'cancelado' && !esDestino) {
      throw new AuthError('Solo la sucursal que lo recibe puede aceptarlo o rechazarlo; tú puedes cancelar el envío.', 403)
    }
  }

  // El 409 y no un 400: la petición era válida, lo que cambió es el estado del
  // traspaso. Casi siempre es que alguien más lo resolvió primero, así que el
  // mensaje dice cómo quedó en vez de solo negarse.
  if (traspaso.estado !== 'pendiente') {
    throw new ConflictError(
      `Este traspaso ya no está pendiente: quedó como ${ESTADO_TEXTO[traspaso.estado]}` +
      (traspaso.resuelto_por ? ` por ${traspaso.resuelto_por}.` : '.')
    )
  }

  const resuelto = await repo.resolverTraspaso(id, estado, usuarioEmail, motivo)
  // Null significa que entre la lectura de arriba y el UPDATE alguien más lo
  // resolvió. Es la misma situación, contada por la carrera en vez de por la
  // consulta previa.
  if (!resuelto) {
    throw new ConflictError('Alguien más resolvió este traspaso hace un momento.')
  }
  return resuelto
}

const ESTADO_TEXTO: Record<string, string> = {
  aceptado:  'aceptado',
  rechazado: 'rechazado',
  cancelado: 'cancelado',
}

// ---------------------------------------------------------------------------
// Mínimos y máximos
// ---------------------------------------------------------------------------

export async function getMinimos(sucursalId?: number) {
  if (sucursalId !== undefined) await exigirSucursal(sucursalId)
  return repo.findMinimos(sucursalId)
}

export async function getFaltantes(sucursalId?: number) {
  if (sucursalId !== undefined) await exigirSucursal(sucursalId)
  return repo.findFaltantes(sucursalId)
}

export async function getExcedentes(sucursalId?: number) {
  if (sucursalId !== undefined) await exigirSucursal(sucursalId)
  return repo.findExcedentes(sucursalId)
}

export async function createMinimo(data: MinimoCreate) {
  const sucursal = await exigirSucursal(data.sucursal_id)

  const pieza = await refaccionesRepo.findById(data.pieza_id)
  if (!pieza) throw new NotFoundError('Refacción')

  // Los límites van por refacción exacta a propósito: el mínimo sirve para
  // tener lista la pieza concreta que esa sucursal necesita en una emergencia,
  // y "una del mismo tipo" no siempre sirve. Por eso el mínimo y el máximo de
  // una refacción viven en una sola fila.
  const existente = await repo.findMinimoDe(data.sucursal_id, data.pieza_id)
  if (existente) {
    throw new ConflictError(
      `${sucursal.nombre} ya tiene límites definidos para ${pieza.numero_serie}. Edítalos en lugar de crear otros.`
    )
  }

  return repo.createMinimo(
    data.sucursal_id, data.pieza_id, data.minimo ?? null, data.maximo ?? null, data.observaciones,
  )
}

export async function updateMinimo(id: number, data: MinimoUpdate) {
  const actual = await repo.findMinimoById(id)
  if (!actual) throw new NotFoundError('Límites')

  // Cómo queda la fila después de esta edición. Se arma aquí y no en el
  // esquema porque las dos reglas miran los dos límites a la vez, y una
  // edición puede traer sólo uno: quitar el mínimo de una fila sin máximo la
  // dejaría sin vigilar nada, y bajar el máximo por debajo de un mínimo que no
  // viene en el payload pasaría el esquema sin que nadie lo notara.
  const minimo = data.minimo !== undefined ? data.minimo ?? null : actual.minimo
  const maximo = data.maximo !== undefined ? data.maximo ?? null : actual.maximo

  if (minimo == null && maximo == null) {
    throw new ValidationError(
      'Deja al menos un mínimo o un máximo. Para dejar de vigilar la refacción, quita el renglón.'
    )
  }
  if (minimo != null && maximo != null && maximo < minimo) {
    throw new ValidationError('El máximo no puede ser menor que el mínimo')
  }

  const actualizado = await repo.updateMinimo(id, data.minimo, data.maximo, data.observaciones)
  if (!actualizado) throw new NotFoundError('Límites')
  return actualizado
}

export async function removeMinimo(id: number) {
  const ok = await repo.removeMinimo(id)
  if (!ok) throw new NotFoundError('Límites')
}
