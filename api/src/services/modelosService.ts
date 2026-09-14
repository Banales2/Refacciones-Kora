import * as repo from '../repositories/modelosRepo'
import { NotFoundError, ConflictError } from '../shared/errors'

export function getAll(incluirDescontinuados = false) {
  return repo.findAll(incluirDescontinuados)
}

export async function create(marca: string, nombre: string, anio: string | null, tiposPermitidos?: string[]) {
  const m = marca.trim(), n = nombre.trim()
  if (await repo.existsDuplicate(m, n, anio)) {
    throw new ConflictError('Ya existe un modelo con esa marca, nombre y año')
  }
  return repo.create(m, n, anio, tiposPermitidos)
}

export async function update(id: number, marca?: string, nombre?: string, anio?: string | null, tiposPermitidos?: string[]) {
  const actual = await repo.findById(id)
  if (!actual) throw new NotFoundError('Modelo')

  // Valores efectivos tras el update (los no enviados conservan el actual).
  const m = marca?.trim() ?? actual.marca
  const n = nombre?.trim() ?? actual.nombre
  const a = anio !== undefined ? anio : actual.anio
  if (await repo.existsDuplicate(m, n, a, id)) {
    throw new ConflictError('Ya existe un modelo con esa marca, nombre y año')
  }

  const result = await repo.update(id, marca?.trim(), nombre?.trim(), anio, tiposPermitidos)
  if (!result) throw new NotFoundError('Modelo')
  return result
}

// Descontinuar, no borrar. El modelo se retira del catálogo y del selector del
// alta, pero se queda entero: su programa de mantenimiento, sus garantías y sus
// tipos de pieza siguen ahí, y las unidades que ya lo usan lo siguen mostrando
// y siguen su programa igual.
export async function descontinuar(id: number, motivo?: string) {
  const actual = await repo.findById(id)
  if (!actual) throw new NotFoundError('Modelo')
  if (actual.descontinuado_en) throw new ConflictError('Este modelo ya está descontinuado')
  const result = await repo.descontinuar(id, motivo?.trim() || null)
  if (!result) throw new NotFoundError('Modelo')
  return result
}

export async function reactivar(id: number) {
  const actual = await repo.findById(id)
  if (!actual) throw new NotFoundError('Modelo')
  if (!actual.descontinuado_en) throw new ConflictError('Este modelo ya se está usando')
  const result = await repo.reactivar(id)
  if (!result) throw new NotFoundError('Modelo')
  return result
}
