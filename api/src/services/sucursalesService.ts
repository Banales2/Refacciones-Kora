import * as repo from '../repositories/sucursalesRepo'
import { NotFoundError, ConflictError } from '../shared/errors'

export function getAll() { return repo.findAll() }

export function create(nombre: string, ubicacion: string) {
  return repo.create(nombre.trim(), ubicacion.trim())
}

export async function update(id: number, nombre?: string, ubicacion?: string) {
  const result = await repo.update(id, nombre?.trim(), ubicacion?.trim())
  if (!result) throw new NotFoundError('Sucursal')
  return result
}

export async function remove(id: number) {
  const count = await repo.countCamiones(id)
  if (count > 0)
    throw new ConflictError(`Esta sucursal tiene ${count} unidad(es) de reparto asignada(s) y no puede eliminarse`)
  // Borrar una sucursal con piezas dentro no es un borrado: es perder de vista
  // inventario. Hay que vaciarla con traspasos primero.
  const piezas = await repo.countExistencias(id)
  if (piezas > 0)
    throw new ConflictError(
      `Esta sucursal tiene ${piezas} pieza(s) en inventario y no puede eliminarse. ` +
      `Traspásalas a otra sucursal primero.`
    )

  const deleted = await repo.remove(id)
  if (!deleted) throw new NotFoundError('Sucursal')
}
