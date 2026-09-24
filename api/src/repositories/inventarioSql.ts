// Fragmentos de SQL sobre el inventario que usan varios repositorios. Viven
// aquí y no en uno de ellos porque los repositorios no se importan entre sí, y
// cuando cada uno traía su propia definición de "cuánto queda" se
// desincronizaban.
//
// Desde la migración 002 el stock de un lote no es una columna sino la suma de
// sus existencias por sucursal. `lotes_pieza.cantidad_disponible` sigue en la
// tabla pero está OBSOLETA: nadie la lee, y la migración 003 la dropea.
import * as sql from 'mssql'
import { getPool } from '../shared/db'

/**
 * Hoy en la zona horaria de la empresa.
 *
 * Azure SQL corre en UTC, y entre las 18:00 y la medianoche de México ahí ya es
 * mañana: un `CAST(GETDATE() AS date)` daría por llegado desde la tarde
 * anterior un lote que llega mañana. Es el mismo problema que resuelve
 * `shared/fechaMexico` del lado de TypeScript, y la misma respuesta.
 *
 * Va como expresión y no como parámetro para poder pegarse en cualquier
 * consulta sin obligarla a declarar un `@hoy` que casi todas olvidarían.
 */
export const HOY_MX =
  "CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Central Standard Time (Mexico)' AS date)"

/**
 * ¿Este lote ya está en el estante? `alias` es el alias de `lotes_pieza`.
 *
 * `fecha_llegada` NULL es todo lo capturado antes de la migración 051 y todo lo
 * que se captura ya recibido: sin fecha que esperar, el lote está aquí.
 *
 * Esta es LA definición de "disponible de verdad", y por eso vive junto a las
 * de existencia y no repetida en cada repositorio: lo que un lote en tránsito
 * no puede es contarse ni consumirse, y las dos cosas se preguntan desde media
 * docena de consultas distintas.
 */
export function loteLlegado(alias = 'l'): string {
  return `(${alias}.fecha_llegada IS NULL OR ${alias}.fecha_llegada <= ${HOY_MX})`
}

/**
 * Lo que queda de un lote sumando todas las sucursales. `alias` es el alias que
 * la consulta le dio a `lotes_pieza` (normalmente 'l').
 */
export function disponibleDelLote(alias = 'l'): string {
  return `(SELECT COALESCE(SUM(ex.cantidad), 0)
           FROM existencias_lote ex WHERE ex.lote_id = ${alias}.id)`
}

/**
 * Si el lote todavía no llega, la fecha en que llega; `null` si ya está aquí
 * (o si el lote no existe, que lo contesta quien pregunta).
 *
 * Lo usan las tres puertas por las que una pieza sale del almacén —el consumo
 * de un mantenimiento, el montaje en una unidad y el traspaso entre
 * sucursales— para negarse con una fecha en vez de con un "no hay
 * existencia", que sería mentira: la pieza existe, todavía no está.
 */
export async function llegadaPendiente(loteId: number): Promise<string | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, loteId)
    .query(`
      SELECT CONVERT(char(10), l.fecha_llegada, 23) AS fecha
      FROM lotes_pieza l
      WHERE l.id = @id AND NOT ${loteLlegado('l')}`)
  return r.recordset[0]?.fecha ?? null
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
/**
 * El lote donde se guardan las piezas que vuelven al estante sin haber salido de
 * una compra, para una refacción y una sucursal. Lo crea la primera vez y lo
 * reutiliza después.
 *
 * Existe porque las existencias cuelgan de la pareja (lote, sucursal): una pieza
 * que vino con el vehículo nunca tuvo lote, así que sin esto no hay forma de
 * contarla y se perdía en silencio.
 *
 * NO representa una compra, y de ahí sus tres marcas, que son también la llave
 * por la que se le vuelve a encontrar:
 *
 *   proveedor_id NULL - no se le compró a nadie (migración 024).
 *   num_factura  NULL - no hay papel que cuadrar. `facturasRepo` deja fuera los
 *                       lotes sin folio, así que no ensucia esa pantalla.
 *   costo_unitario 0  - la pieza ya se pagó al comprar el vehículo. Cobrarla otra
 *                       vez la contaría dos veces, y como todos los totales son
 *                       SUM(cantidad * costo_unitario), a cero cuenta en unidades
 *                       pero no en pesos.
 *
 * `cantidad_inicial` crece con cada pieza que entra: es cuántas ha llegado a
 * guardar este lote. El stock real sigue saliendo de `existencias_lote`.
 */
export async function loteDeRecuperacion(
  tx: sql.Transaction, piezaId: number, sucursalId: number, hoy: string,
): Promise<number> {
  const existente = await tx.request()
    .input('pid', sql.Int, piezaId)
    .input('suc', sql.Int, sucursalId)
    .query(`
      SELECT TOP 1 id FROM lotes_pieza
      WHERE pieza_id = @pid AND sucursal_id = @suc
        AND proveedor_id IS NULL AND num_factura IS NULL AND costo_unitario = 0
      ORDER BY id`)

  if (existente.recordset[0]) {
    const id = existente.recordset[0].id as number
    // Una más de las que este lote ha llegado a guardar. `cantidad_disponible`
    // se mantiene al día por lo mismo que en el alta: que quien mire la tabla a
    // mano no vea un número engañoso. Nadie la lee.
    await tx.request()
      .input('id', sql.Int, id)
      .query(`
        UPDATE lotes_pieza
        SET cantidad_inicial = cantidad_inicial + 1,
            cantidad_disponible = cantidad_disponible + 1
        WHERE id = @id`)
    return id
  }

  const creado = await tx.request()
    .input('pid',   sql.Int, piezaId)
    .input('suc',   sql.Int, sucursalId)
    .input('fecha', sql.Date, hoy)
    .query(`
      INSERT INTO lotes_pieza
        (pieza_id, proveedor_id, sucursal_id, fecha_compra, costo_unitario,
         cantidad_inicial, cantidad_disponible, num_factura, comprado_por, autorizado_por)
      OUTPUT INSERTED.id
      VALUES
        (@pid, NULL, @suc, @fecha, 0, 1, 1, NULL,
         'Recuperada de una unidad', 'Sistema')`)
  return creado.recordset[0].id as number
}

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
