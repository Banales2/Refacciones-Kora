import * as repo from '../repositories/inventarioRepo'
import * as sucursalesRepo from '../repositories/sucursalesRepo'
import * as refaccionesRepo from '../repositories/refaccionesRepo'
import { TraspasoCreate, MinimoCreate, MinimoUpdate } from '../schemas/inventarioSchema'
import { NotFoundError, ValidationError, ConflictError } from '../shared/errors'

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
