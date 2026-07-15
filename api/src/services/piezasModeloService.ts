import * as repo from '../repositories/piezasModeloRepo'
import type { PiezaDeModelo } from '../repositories/piezasModeloRepo'
import * as modelosRepo from '../repositories/modelosRepo'
import { NotFoundError } from '../shared/errors'

export async function getByModelo(modeloId: number): Promise<PiezaDeModelo[]> {
  return repo.findByModelo(modeloId)
}

export async function addPiezas(modeloId: number, piezaIds: number[]): Promise<void> {
  const modelo = await modelosRepo.findById(modeloId)
  if (!modelo) throw new NotFoundError('Modelo')
  await repo.addPiezas(modeloId, piezaIds)
}

export async function removePieza(modeloId: number, piezaId: number): Promise<void> {
  const ok = await repo.removePieza(modeloId, piezaId)
  if (!ok) throw new NotFoundError('Pieza en este modelo')
}
