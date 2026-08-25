// Fragmentos de SQL sobre el inventario que usan varios repositorios. Viven
// aquí y no en uno de ellos porque los repositorios no se importan entre sí, y
// cuando cada uno traía su propia definición de "cuánto queda" se
// desincronizaban.
//
// Desde la migración 002 el stock de un lote no es una columna sino la suma de
// sus existencias por sucursal. `lotes_pieza.cantidad_disponible` sigue en la
// tabla pero está OBSOLETA: nadie la lee, y la migración 003 la dropea.
import * as sql from 'mssql'

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

/**
 * Mueve la existencia de (lote, sucursal) en `delta`. Positivo devuelve al
 * almacén, negativo consume. El UPDATE-then-INSERT cubre la devolución a una
 * sucursal que se quedó sin fila al agotarse.
 *
 * El CHECK de la tabla impide dejarla en negativo: si el cálculo se equivoca,
 * la transacción revienta en lugar de dejar un inventario imposible.
 *
 * Vive aquí porque desde la migración 008 lo llaman dos repositorios: el
 * consumo de un mantenimiento y el montaje de una pieza en un vehículo. Son las
 * dos puertas por las que una pieza sale del almacén, y tienen que mover el
 * inventario igual.
 */
export async function moverExistencia(
  tx: sql.Transaction, loteId: number, sucursalId: number, delta: number,
): Promise<void> {
  await tx.request()
    .input('lid',   sql.Int, loteId)
    .input('suc',   sql.Int, sucursalId)
    .input('delta', sql.Int, delta)
    .query(`
      UPDATE existencias_lote SET cantidad = cantidad + @delta
      WHERE lote_id = @lid AND sucursal_id = @suc;

      IF @@ROWCOUNT = 0
        INSERT INTO existencias_lote (lote_id, sucursal_id, cantidad)
        VALUES (@lid, @suc, @delta);`)
}
