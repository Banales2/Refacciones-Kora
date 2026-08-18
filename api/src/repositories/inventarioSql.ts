// Fragmentos de SQL sobre el inventario que usan varios repositorios. Viven
// aquí y no en uno de ellos porque los repositorios no se importan entre sí, y
// cuando cada uno traía su propia definición de "cuánto queda" se
// desincronizaban.
//
// Desde la migración 002 el stock de un lote no es una columna sino la suma de
// sus existencias por sucursal. `lotes_pieza.cantidad_disponible` sigue en la
// tabla pero está OBSOLETA: nadie la lee, y la migración 003 la dropea.

/**
 * Lo que queda de un lote sumando todas las sucursales. `alias` es el alias que
 * la consulta le dio a `lotes_pieza` (normalmente 'l').
 */
export function disponibleDelLote(alias = 'l'): string {
  return `(SELECT COALESCE(SUM(ex.cantidad), 0)
           FROM existencias_lote ex WHERE ex.lote_id = ${alias}.id)`
}

/**
 * Lo que queda de un lote en una sucursal concreta. `param` es el nombre del
 * parámetro de la consulta que trae el id de la sucursal (con arroba).
 */
export function disponibleEnSucursal(alias = 'l', param = '@sucursalId'): string {
  return `(SELECT COALESCE(SUM(ex.cantidad), 0)
           FROM existencias_lote ex
           WHERE ex.lote_id = ${alias}.id AND ex.sucursal_id = ${param})`
}
