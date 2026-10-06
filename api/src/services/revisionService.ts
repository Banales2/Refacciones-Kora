import * as repo from '../repositories/revisionRepo'
import { AppError, ConflictError, NotFoundError } from '../shared/errors'
import { RENGLON_REVISADO } from '../shared/revision'

// Lo que rodea a la revisión de una factura: reabrirla, quitar el renglón que
// sobra y los reportes de errores.
//
// La revisión misma —comparar el papel contra lo capturado, cabecera incluida,
// corregir y sellar— vive en `cuadreFacturaService.cuadrar`. Hubo aquí una
// revisión de cabecera aparte, y se quitó: sellaba la cabecera sola y la factura
// ya no se podía cuadrar, porque el cuadre exige una cabecera sin sellar.

/** Quita los sellos de la factura para poder corregirla. Las correcciones ya registradas se quedan. */
export async function reabrir(facturaId: number): Promise<number> {
  const c = await repo.leerCabecera(facturaId)
  if (!c) throw new NotFoundError('Factura')
  return repo.reabrir(facturaId)
}

/**
 * Quita el renglón que se capturó de más y no está en el papel.
 *
 * Antes comprueba que de verdad nunca existió. El caso que más se parece a este
 * y NO es este: el renglón sí se compró, pero pertenece a otra factura. Eso se
 * mueve, no se borra, y el mensaje lo dice.
 */
export async function quitarRenglon(
  loteId: number,
): Promise<{ factura_id: number | null; factura_borrada: boolean }> {
  const r = await repo.leerRenglon(loteId)
  if (!r) throw new NotFoundError('Renglón')

  if (r.revisado_en !== null) {
    throw new AppError(
      'Este renglón ya fue revisado. Reabre la revisión de la factura para poder quitarlo.',
      409, RENGLON_REVISADO,
    )
  }

  const motivos = await repo.motivosParaNoQuitar(loteId)
  if (motivos.length > 0) {
    throw new ConflictError(
      `No se puede quitar este renglón porque ${motivos.join('; ')}. ` +
      'Si la compra sí existió pero es de otra factura, no lo quites: cámbiale el folio para moverlo.',
    )
  }

  const borrado = await repo.quitarRenglon(loteId)
  if (!borrado) throw new NotFoundError('Renglón')

  const facturaBorrada = r.factura_id !== null
    ? await repo.borrarFacturaSiQuedoVacia(r.factura_id)
    : false

  return { factura_id: r.factura_id, factura_borrada: facturaBorrada }
}

/** Cuánto lleva equivocado cada quien. */
export async function errores(desde?: string, hasta?: string) {
  return repo.erroresPorPersona(desde, hasta)
}

/** Lo que se corrigió en una factura. */
export async function correcciones(facturaId: number) {
  return repo.correccionesDeFactura(facturaId)
}

/** El detalle detrás del acumulado: qué correcciones lo componen. */
export async function detalleCorrecciones(
  desde?: string, hasta?: string, capturadoPor?: string,
) {
  return repo.correccionesEnRango(desde, hasta, capturadoPor)
}
