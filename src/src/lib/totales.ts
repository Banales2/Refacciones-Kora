// Los totales de una compra, calculados a partir de lo que guarda el lote.
//
// Lo único que se guarda son los dos porcentajes: la tasa de IVA
// (`lotes_pieza.tasa_iva`, migración 020) y el descuento del proveedor
// (`lotes_pieza.descuento_pct`, migración 021). Los importes se calculan donde
// se muestren, y por eso viven aquí: guardarlos sería repetir datos derivados
// que quedan desalineados del costo en cuanto alguien corrija un renglón.
//
// EL ORDEN IMPORTA, y es el del papel: el descuento se resta al subtotal y el
// IVA se calcula sobre lo que queda, nunca sobre el subtotal sin descontar.
//
//   subtotal  → suma de costo × cantidad de los renglones, a precio de lista
//   descuento → subtotal × descuento_pct / 100
//   base      → subtotal − descuento
//   iva       → base × tasa_iva / 100
//   total     → base + iva
//
// `null` NO es cero en ninguno de los dos. En la tasa significa que el precio
// capturado YA incluye IVA (o que la compra es exenta); en el descuento, que la
// factura no trae ninguno. Son el valor de todo lo anterior a las migraciones y
// el de toda captura que no active la casilla, así que estas funciones dejan el
// subtotal intacto — ningún total existente se mueve.

/** La tasa que se ofrece por defecto al activar la casilla. */
export const IVA_DEFAULT = 16

/** El descuento que se ofrece por defecto al activar la casilla. */
export const DESCUENTO_DEFAULT = 10

/** Lo que el proveedor descuenta del subtotal. 0 si la factura no trae descuento. */
export function importeDescuento(subtotal: number, pct: number | null | undefined): number {
  if (!pct) return 0
  return subtotal * (pct / 100)
}

/**
 * Lo que hay que sumarle a la base gravable. 0 si el precio ya incluye IVA.
 *
 * Ojo con el primer argumento: es la base —el subtotal YA descontado—, no el
 * subtotal. Quien tenga descuento tiene que restarlo antes, o usar
 * `totalesFactura`, que lleva el orden por su cuenta.
 */
export function importeIva(base: number, tasa: number | null | undefined): number {
  if (!tasa) return 0
  return base * (tasa / 100)
}

/** La base ya con IVA. Igual a la base si el precio ya lo incluye. */
export function conIva(base: number, tasa: number | null | undefined): number {
  return base + importeIva(base, tasa)
}

export interface TotalesFactura {
  subtotal:  number
  /** Lo descontado, en pesos. 0 si la factura no trae descuento. */
  descuento: number
  /** Subtotal menos descuento: sobre esto se calcula el IVA. */
  base:      number
  iva:       number
  total:     number
}

/**
 * El desglose completo de una factura, en el orden en que lo emite el
 * proveedor. Es la única forma de calcularlo que hay que usar: hacerlo a mano
 * en cada pantalla es donde se cuela el IVA cobrado sobre el subtotal sin
 * descontar, que infla el total y nunca cuadra contra el papel.
 */
export function totalesFactura(
  subtotal: number,
  descuentoPct: number | null | undefined,
  tasaIva: number | null | undefined,
): TotalesFactura {
  const descuento = importeDescuento(subtotal, descuentoPct)
  const base = subtotal - descuento
  const iva = importeIva(base, tasaIva)
  return { subtotal, descuento, base, iva, total: base + iva }
}
