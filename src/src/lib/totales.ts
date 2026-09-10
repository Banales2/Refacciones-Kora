// El IVA de una compra, calculado a partir de lo que guarda el lote.
//
// Lo único que se guarda es la tasa (`lotes_pieza.tasa_iva`, migración 020). El
// importe se calcula donde se muestre, y por eso vive aquí: guardarlo sería
// repetir un dato derivado que puede quedar desalineado del costo si alguien
// corrige el lote.
//
// `null` NO es "tasa cero": significa que el precio capturado YA incluye IVA (o
// que la compra es exenta). Es el valor de todo lo anterior a la migración y el
// de toda captura que no active la casilla, así que estas funciones devuelven 0
// de IVA y dejan el subtotal intacto — ningún total existente se mueve.

/** La tasa que se ofrece por defecto al activar la casilla. */
export const IVA_DEFAULT = 16

/** Lo que hay que sumarle al subtotal. 0 si el precio ya lo incluye. */
export function importeIva(subtotal: number, tasa: number | null | undefined): number {
  if (!tasa) return 0
  return subtotal * (tasa / 100)
}

/** El subtotal ya con IVA. Igual al subtotal si el precio ya lo incluye. */
export function conIva(subtotal: number, tasa: number | null | undefined): number {
  return subtotal + importeIva(subtotal, tasa)
}
