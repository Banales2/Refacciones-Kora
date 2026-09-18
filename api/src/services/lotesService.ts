import * as repo from '../repositories/lotesRepo'
import { LoteConProveedor } from '../types/domain'
import { LoteCreate, LoteUpdate } from '../schemas/loteSchema'
import { NotFoundError, ValidationError } from '../shared/errors'

export async function createLote(
  piezaId: number, data: LoteCreate, autorizadoPor: string
): Promise<LoteConProveedor> {
  return repo.create(piezaId, data, autorizadoPor)
}

/**
 * Aplica los cambios del lote.
 *
 * NO comprueba el candado de la revisión: lo hace `lote-update.ts`, que es el
 * endpoint por el que llega una edición normal. Aquí no puede estar porque la
 * revisión misma pasa por esta función para aplicar sus correcciones, y con el
 * candado aquí el verificador no podría corregir nada. Ver `shared/revision`.
 */
export async function updateLote(id: number, data: LoteUpdate): Promise<LoteConProveedor> {
  let delta: number | undefined

  if (data.cantidad_inicial !== undefined) {
    const raw = await repo.getRaw(id)
    if (!raw) throw new NotFoundError('Lote')

    const usadas = raw.cantidad_inicial - raw.cantidad_disponible
    if (data.cantidad_inicial < usadas) {
      throw new ValidationError(
        `No se puede reducir la cantidad inicial a ${data.cantidad_inicial}: ya se usaron ${usadas} unidades`
      )
    }

    delta = data.cantidad_inicial - raw.cantidad_inicial

    // La corrección se aplica en la sucursal que recibió el lote. Si las
    // unidades que sobran ya se traspasaron a otra parte, ahí no hay qué
    // quitar: hay que devolverlas primero, porque descontarlas de una sucursal
    // que no las tiene dejaría el inventario mintiendo en las dos.
    if (delta < 0 && raw.disponible_en_origen + delta < 0) {
      throw new ValidationError(
        `Solo quedan ${raw.disponible_en_origen} unidades de este lote en su sucursal de origen. ` +
        `Traspasa de vuelta las que falten antes de reducir la cantidad.`
      )
    }
  }

  const result = await repo.update(id, data, delta)
  if (!result) throw new NotFoundError('Lote')
  return result
}

export async function getProveedores(): Promise<{ id: number; nombre: string }[]> {
  return repo.findProveedores()
}
