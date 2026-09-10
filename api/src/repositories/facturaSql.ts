// Fragmentos de SQL para leer un lote junto con la cabecera de su factura.
//
// Desde la migración 026 la cabecera de una compra —folio, proveedor, fecha,
// IVA, descuento, quién compró y quién autorizó— vive en `facturas`, no copiada
// en cada renglón. Pero no todos los lotes tienen factura: el de recuperación
// (migración 024) no salió de ninguna compra y conserva lo suyo.
//
// De ahí la regla, que es la única forma de que no haya dos verdades:
//
//   factura_id NOT NULL -> la cabecera está en `facturas`. Las columnas
//                          equivalentes del lote están en NULL.
//   factura_id NULL     -> lote sin compra. Usa sus propias columnas.
//
// Estos fragmentos hacen el COALESCE una sola vez y en un solo lugar, para que
// ninguna consulta tenga que acordarse de la regla. Viven aquí y no dentro de un
// repositorio por lo mismo que `inventarioSql`: los repos no se importan entre
// sí, y cuando cada uno traía su propia definición se desincronizaban.

/** El JOIN que le devuelve al lote su cabecera. `alias` es el de `lotes_pieza`. */
export function joinFactura(alias = 'l', fac = 'fac'): string {
  return `LEFT JOIN facturas ${fac} ON ${fac}.id = ${alias}.factura_id`
}

/** El proveedor del lote: el de su factura, o ninguno si no tiene compra. */
export function proveedorDelLote(alias = 'l', fac = 'fac'): string {
  return `COALESCE(${fac}.proveedor_id, ${alias}.proveedor_id)`
}

/** La fecha de compra del lote. */
export function fechaDelLote(alias = 'l', fac = 'fac'): string {
  return `COALESCE(${fac}.fecha_compra, ${alias}.fecha_compra)`
}

/** El folio de la factura del lote. NULL si no salió de una compra. */
export function folioDelLote(alias = 'l', fac = 'fac'): string {
  return `COALESCE(${fac}.folio, ${alias}.num_factura)`
}

/**
 * El JOIN al proveedor pasando por la factura. Siempre LEFT: el lote de
 * recuperación no tiene proveedor y aun así tiene que aparecer en el inventario
 * — es stock real en el estante.
 */
export function joinProveedorDelLote(alias = 'l', fac = 'fac', pr = 'pr'): string {
  return `LEFT JOIN proveedores ${pr} ON ${pr}.id = ${proveedorDelLote(alias, fac)}`
}

/**
 * Las columnas de cabecera con los nombres que la API ya devolvía cuando vivían
 * en el lote. Cambió dónde se guardan, no lo que se ve: gracias a esto el
 * frontend no se entera de la migración.
 */
export function colsCabecera(alias = 'l', fac = 'fac'): string {
  return `${folioDelLote(alias, fac)} AS num_factura,
          ${fechaDelLote(alias, fac)} AS fecha_compra,
          ${proveedorDelLote(alias, fac)} AS proveedor_id,
          COALESCE(${fac}.tasa_iva,       ${alias}.tasa_iva)       AS tasa_iva,
          COALESCE(${fac}.descuento_pct,  ${alias}.descuento_pct)  AS descuento_pct,
          COALESCE(${fac}.comprado_por,   ${alias}.comprado_por)   AS comprado_por,
          COALESCE(${fac}.autorizado_por, ${alias}.autorizado_por) AS autorizado_por`
}
