import * as repo from '../repositories/inventarioRepo'
import * as sucursalesRepo from '../repositories/sucursalesRepo'
import * as refaccionesRepo from '../repositories/refaccionesRepo'
import { TraspasoCreate, MinimoCreate, MinimoUpdate } from '../schemas/inventarioSchema'
import { NotFoundError, ValidationError, ConflictError } from '../shared/errors'
import { type Alcance, sucursalPermitida } from '../shared/alcance'
import { AuthError } from '../shared/auth'

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
// Mínimos
// ---------------------------------------------------------------------------

export async function getMinimos(sucursalId?: number) {
  if (sucursalId !== undefined) await exigirSucursal(sucursalId)
  return repo.findMinimos(sucursalId)
}

export async function getFaltantes(sucursalId?: number) {
  if (sucursalId !== undefined) await exigirSucursal(sucursalId)
  return repo.findFaltantes(sucursalId)
}

export async function createMinimo(data: MinimoCreate) {
  const sucursal = await exigirSucursal(data.sucursal_id)

  const pieza = await refaccionesRepo.findById(data.pieza_id)
  if (!pieza) throw new NotFoundError('Refacción')

  // El mínimo es por refacción exacta a propósito: sirve para tener lista la
  // pieza concreta que esa sucursal necesita en una emergencia, y "una del
  // mismo tipo" no siempre sirve. Por eso solo puede haber uno.
  const existente = await repo.findMinimoDe(data.sucursal_id, data.pieza_id)
  if (existente) {
    throw new ConflictError(
      `${sucursal.nombre} ya tiene un mínimo definido para ${pieza.numero_serie}. Edítalo en lugar de crear otro.`
    )
  }

  return repo.createMinimo(data.sucursal_id, data.pieza_id, data.minimo, data.observaciones)
}

export async function updateMinimo(id: number, data: MinimoUpdate) {
  const actualizado = await repo.updateMinimo(id, data.minimo, data.observaciones)
  if (!actualizado) throw new NotFoundError('Mínimo')
  return actualizado
}

export async function removeMinimo(id: number) {
  const ok = await repo.removeMinimo(id)
  if (!ok) throw new NotFoundError('Mínimo')
}
