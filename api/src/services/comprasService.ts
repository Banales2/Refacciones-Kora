import * as repo from '../repositories/comprasRepo'
import * as refaccionesRepo from '../repositories/refaccionesRepo'
import { CompraCreate } from '../schemas/compraSchema'
import { ConflictError, NotFoundError } from '../shared/errors'

/**
 * Registra una factura de compra con varios renglones.
 *
 * Todo lo que se puede rechazar se rechaza ANTES de abrir la transacción: un
 * rollback también deshace las refacciones nuevas de los renglones anteriores,
 * y el usuario tendría que volver a capturarlas sin que el mensaje le diga cuál
 * de los quince renglones fue el del problema.
 */
export async function crearCompra(
  data: CompraCreate, autorizadoPor: string,
): Promise<repo.CompraCreada> {
  const vistos = new Set<string>()

  for (const [i, renglon] of data.renglones.entries()) {
    const donde = `Renglón ${i + 1}`

    if (renglon.pieza_id !== undefined) {
      const pieza = await refaccionesRepo.findById(renglon.pieza_id)
      if (!pieza) throw new NotFoundError(`${donde}: la refacción`)
      continue
    }

    const serie = renglon.pieza_nueva!.numero_serie
    // Dos renglones dando de alta la misma serie: el índice único de la tabla
    // lo cazaría con un error de constraint, pero solo después de haber hecho
    // media factura y sin decir qué renglones chocan.
    if (vistos.has(serie)) {
      throw new ConflictError(`${donde}: el número de serie ${serie} se repite en esta compra`)
    }
    vistos.add(serie)

    const existente = await refaccionesRepo.findByNumeroSerie(serie)
    if (existente) {
      throw new ConflictError(
        `${donde}: ya existe una refacción con número de serie ${serie}. ` +
        'Elígela del catálogo en vez de darla de alta.'
      )
    }
  }

  return repo.crearCompra(data, autorizadoPor)
}
