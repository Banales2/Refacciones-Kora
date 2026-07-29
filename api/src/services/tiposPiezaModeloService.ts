import * as repo from '../repositories/tiposPiezaModeloRepo'
import type { TipoPiezaDeModelo } from '../repositories/tiposPiezaModeloRepo'
import * as modelosRepo from '../repositories/modelosRepo'
import * as tiposRepo from '../repositories/tiposPiezaRepo'
import { NotFoundError } from '../shared/errors'

export async function getByModelo(modeloId: number): Promise<TipoPiezaDeModelo[]> {
  return repo.findByModelo(modeloId)
}

export async function addTipos(modeloId: number, tipoIds: number[]): Promise<void> {
  const modelo = await modelosRepo.findById(modeloId)
  if (!modelo) throw new NotFoundError('Modelo')

  for (const tipoId of tipoIds) {
    if (!(await tiposRepo.findById(tipoId))) throw new NotFoundError('Tipo de pieza')
  }

  await repo.addTipos(modeloId, tipoIds)
}

export async function removeTipo(modeloId: number, tipoId: number): Promise<void> {
  const ok = await repo.removeTipo(modeloId, tipoId)
  if (!ok) throw new NotFoundError('Tipo de pieza en este modelo')
}
