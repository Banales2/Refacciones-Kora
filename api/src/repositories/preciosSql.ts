// Qué es un precio COMPARABLE, y por qué no es el número que dice el papel.
//
// Hay dos fuentes de precio para una misma refacción con un mismo proveedor, y
// no son la misma cosa:
//
//   cotizado -> `precios_proveedor`. Lo que pide, se le compre o no. Se captura
//               a precio de LISTA, que es como lo manda en su cotización.
//   pagado   -> `lotes_pieza` + `facturas`. Lo que de verdad salió de la caja.
//
// Compararlos crudos da una respuesta equivocada, y la razón es concreta: a
// esta empresa casi siempre le hacen descuento por volumen —del orden del 10%,
// con excepciones— y ese descuento es de la FACTURA, no del renglón. Es decir:
//
//   - En una compra, `costo_unitario` es precio de lista y el descuento vive en
//     `facturas.descuento_pct`. Comparar el costo unitario contra una cotización
//     de otro proveedor ignora el descuento que ya se consiguió.
//   - En una cotización no hay descuento capturado en ningún lado, porque el
//     proveedor cotiza lista y el descuento se pacta después.
//
// Así que el comparable es, en los dos casos, **lo que costaría una pieza ya
// con el descuento aplicado**:
//
//   pagado   -> costo_unitario × (1 − descuento de la factura)   ← un hecho
//   cotizado -> precio × (1 − descuento de referencia)           ← una estimación
//
// El descuento de referencia no se guarda en ningún lado: es un supuesto que se
// pasa a la consulta y que la pantalla muestra, para que quien lea la tabla sepa
// sobre qué se hizo la cuenta y pueda moverlo. Guardarlo sería convertir un
// supuesto en un dato.
//
// EL IVA SE QUEDA FUERA, a propósito. `facturas.tasa_iva` en NULL significa que
// el precio capturado YA lo incluye (migración 020), así que no hay forma de
// quitárselo a esas facturas —no se sabe con qué tasa entró—. Sumárselo a las
// otras dejaría unas con IVA y otras sin él, que es peor que no tocarlo. Es
// además la misma base sobre la que el resto de la app reporta gasto: todos los
// totales son `cantidad × costo_unitario`, sin IVA.

/** El descuento que se supone para una cotización cuando nadie dice otro. */
export const DESCUENTO_REFERENCIA = 10

/**
 * Lo que costó de verdad una pieza de ese lote, ya con el descuento de su
 * factura. `lote` y `fac` son los alias de `lotes_pieza` y `facturas`.
 */
export function precioPagado(lote = 'l', fac = 'fac'): string {
  return `(${lote}.costo_unitario * (1 - COALESCE(${fac}.descuento_pct, 0) / 100.0))`
}

/**
 * Lo que costaría una pieza a ese proveedor si aplicara el descuento de
 * referencia sobre su cotización. `param` es el parámetro que lo trae.
 */
export function precioCotizado(alias = 'pp', param = '@descRef'): string {
  return `(${alias}.precio * (1 - ${param} / 100.0))`
}
