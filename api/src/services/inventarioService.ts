import * as repo from '../repositories/inventarioRepo'
import * as sucursalesRepo from '../repositories/sucursalesRepo'
import * as refaccionesRepo from '../repositories/refaccionesRepo'
import { TraspasoCreate, MinimoCreate, MinimoUpdate } from '../schemas/inventarioSchema'
import { NotFoundError, ValidationError, ConflictError } from '../shared/errors'
import type { Alcance } from '../shared/alcance'

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

export async function createTraspaso(data: TraspasoCreate, usuarioEmail: string) {
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
 * Mientras los roles sean planos —admin/editor sobre toda la flota— no hay a
 * quién bloquearle cuál de las tres acciones. Lo que sí queda es el rastro: el
 * repositorio guarda quién lo resolvió y cuándo. El día que existan roles por
 * sucursal, el candado entra aquí y no hay que volver a tocar el modelo.
 */
export async function resolverTraspaso(
  id: number, estado: 'aceptado' | 'rechazado' | 'cancelado',
  usuarioEmail: string, motivo: string | null,
) {
  const traspaso = await repo.findTraspasoById(id)
  if (!traspaso) throw new NotFoundError('Traspaso')

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
