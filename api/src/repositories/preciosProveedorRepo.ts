import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { PrecioProveedorCreate, PrecioProveedorUpdate } from '../schemas/precioProveedorSchema'
import { DESCUENTO_REFERENCIA, precioCotizado, precioPagado } from './preciosSql'

export interface PrecioProveedor {
  id:             number
  proveedor_id:   number
  pieza_id:       number
  precio:         number
  fecha:          string
  observaciones:  string | null
  registrado_por: string
  /**
   * Lo que costaría de verdad esta cotización con el descuento de referencia.
   * Es el número con el que se compara contra los demás proveedores; `precio`
   * es el de lista, que es como lo manda el proveedor. Ver `preciosSql`.
   */
  precio_comparable: number
  /** El descuento con el que se calculó `precio_comparable`, en por ciento. */
  descuento_referencia: number
  // Datos de la refacción, para no tener que cruzarlos en el cliente.
  pieza_serie:    string
  pieza:          string
  tipo_pieza:     string | null
  /** El precio más reciente que este proveedor tiene para esta refacción. */
  vigente:        boolean
  /**
   * El más barato de esta refacción entre todos los proveedores, ya comparable
   * (ver `preciosSql`): puede salir de una cotización o de una compra real.
   */
  mejor_precio:        number | null
  mejor_proveedor_id:  number | null
  mejor_proveedor:     string | null
  /** De dónde salió ese mejor precio. Null si no hay ninguno. */
  mejor_origen:        'cotizado' | 'pagado' | null
  /** Cuántos proveedores tienen precio —cotizado o pagado— para esta refacción. */
  proveedores_con_precio: number
}

// El precio "vigente" de un proveedor para una refacción es el de fecha más
// reciente (y a igual fecha, el capturado después). Lo mismo vale para lo que se
// le ha pagado: la compra más reciente.
//
// El más barato del mercado se calcula sobre LAS DOS FUENTES, no solo sobre las
// cotizaciones. Un proveedor al que ya se le compra tiene un precio real, y
// dejarlo fuera hacía que "el más barato" solo supiera de quien mandó
// cotización — que suele ser el que menos se usa. Los dos lados se llevan a la
// misma base antes de compararse (ver `preciosSql`).
//
// Requiere el parámetro @descRef: el descuento de referencia con el que se
// estima lo que costaría de verdad una cotización.
const CTE_COMPARATIVA = `
  WITH cotizados AS (
    SELECT pp.id, pp.proveedor_id, pp.pieza_id,
           ${precioCotizado('pp')} AS comparable,
           ROW_NUMBER() OVER (PARTITION BY pp.proveedor_id, pp.pieza_id
                              ORDER BY pp.fecha DESC, pp.id DESC) AS rn
    FROM precios_proveedor pp
  ),
  pagados AS (
    SELECT fac.proveedor_id, l.pieza_id,
           ${precioPagado('l', 'fac')} AS comparable,
           ROW_NUMBER() OVER (PARTITION BY fac.proveedor_id, l.pieza_id
                              ORDER BY fac.fecha_compra DESC, l.id DESC) AS rn
    FROM lotes_pieza l
    -- JOIN y no LEFT: el lote de recuperación (024) no salió de ninguna compra,
    -- vale \$0 y no es el precio de nadie.
    JOIN facturas fac ON fac.id = l.factura_id
  ),
  comparables AS (
    SELECT proveedor_id, pieza_id, comparable, 'cotizado' AS origen
    FROM cotizados WHERE rn = 1
    UNION ALL
    SELECT proveedor_id, pieza_id, comparable, 'pagado' AS origen
    FROM pagados WHERE rn = 1
  ),
  mejores AS (
    SELECT pieza_id, comparable AS mejor_precio, proveedor_id AS mejor_proveedor_id,
           origen AS mejor_origen,
           ROW_NUMBER() OVER (PARTITION BY pieza_id
                              ORDER BY comparable ASC, proveedor_id ASC) AS rn
    FROM comparables
  ),
  conteo AS (
    -- DISTINCT: un proveedor que cotiza Y al que además se le compra es un solo
    -- proveedor, no dos. Sin esto "comparable" se cumpliría con uno solo.
    SELECT pieza_id, COUNT(DISTINCT proveedor_id) AS proveedores_con_precio
    FROM comparables GROUP BY pieza_id
  )
`

const SELECT_PRECIO = `
  SELECT pp.id, pp.proveedor_id, pp.pieza_id, pp.precio,
         CONVERT(char(10), pp.fecha, 23) AS fecha,
         pp.observaciones, pp.registrado_por,
         p.numero_serie AS pieza_serie, p.descripcion AS pieza,
         tp.nombre AS tipo_pieza,
         CAST(CASE WHEN v.rn = 1 THEN 1 ELSE 0 END AS BIT) AS vigente,
         v.comparable AS precio_comparable, @descRef AS descuento_referencia,
         m.mejor_precio, m.mejor_proveedor_id, pm.nombre AS mejor_proveedor,
         m.mejor_origen, c.proveedores_con_precio
  FROM precios_proveedor pp
  JOIN piezas p            ON p.id = pp.pieza_id
  LEFT JOIN tipos_pieza tp ON tp.id = p.tipo_pieza_id
  JOIN cotizados v         ON v.id = pp.id
  LEFT JOIN mejores m      ON m.pieza_id = pp.pieza_id AND m.rn = 1
  LEFT JOIN proveedores pm ON pm.id = m.mejor_proveedor_id
  LEFT JOIN conteo c       ON c.pieza_id = pp.pieza_id
`

// mssql devuelve DECIMAL como string cuando no cabe en un number seguro; aquí
// siempre cabe, pero se normaliza para no dejar al consumidor adivinando.
function normalizar(row: Record<string, unknown>): PrecioProveedor {
  return {
    ...row,
    precio:               Number(row.precio),
    precio_comparable:    Number(row.precio_comparable),
    descuento_referencia: Number(row.descuento_referencia),
    mejor_precio: row.mejor_precio == null ? null : Number(row.mejor_precio),
  } as PrecioProveedor
}

// Todos los precios que este proveedor tiene registrados, del más reciente al
// más viejo dentro de cada refacción: el primero de cada grupo es el vigente.
export async function findByProveedor(
  proveedorId: number, descuentoRef = DESCUENTO_REFERENCIA,
): Promise<PrecioProveedor[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('pid', sql.Int, proveedorId)
    .input('descRef', sql.Decimal(5, 2), descuentoRef)
    .query(`
      ${CTE_COMPARATIVA}
      ${SELECT_PRECIO}
      WHERE pp.proveedor_id = @pid
      ORDER BY p.descripcion, p.numero_serie, pp.fecha DESC, pp.id DESC
    `)
  return r.recordset.map(normalizar)
}

export async function findById(id: number): Promise<PrecioProveedor | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .input('descRef', sql.Decimal(5, 2), DESCUENTO_REFERENCIA)
    .query(`
      ${CTE_COMPARATIVA}
      ${SELECT_PRECIO}
      WHERE pp.id = @id
    `)
  return r.recordset[0] ? normalizar(r.recordset[0]) : null
}

export async function create(
  proveedorId: number, data: PrecioProveedorCreate, registradoPor: string
): Promise<PrecioProveedor> {
  const pool = await getPool()
  const r = await pool.request()
    .input('proveedor_id',   sql.Int,             proveedorId)
    .input('pieza_id',       sql.Int,             data.pieza_id)
    .input('precio',         sql.Decimal(18, 2),  data.precio)
    .input('fecha',          sql.Date,            data.fecha)
    .input('observaciones',  sql.NVarChar(255),   data.observaciones ?? null)
    .input('registrado_por', sql.NVarChar(120),   registradoPor)
    .query(`
      INSERT INTO precios_proveedor
        (proveedor_id, pieza_id, precio, fecha, observaciones, registrado_por)
      OUTPUT INSERTED.id
      VALUES (@proveedor_id, @pieza_id, @precio, @fecha, @observaciones, @registrado_por)
    `)
  return findById(r.recordset[0].id) as Promise<PrecioProveedor>
}

// Ni el proveedor ni la refacción se editan: cambiarlos convertiría el registro
// en otro. Se corrige lo que se pudo capturar mal.
export async function update(id: number, data: PrecioProveedorUpdate): Promise<PrecioProveedor | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)

  if (data.precio !== undefined) {
    req.input('precio', sql.Decimal(18, 2), data.precio)
    sets.push('precio = @precio')
  }
  if (data.fecha !== undefined) {
    req.input('fecha', sql.Date, data.fecha)
    sets.push('fecha = @fecha')
  }
  if (data.observaciones !== undefined) {
    req.input('observaciones', sql.NVarChar(255), data.observaciones ?? null)
    sets.push('observaciones = @observaciones')
  }
  if (!sets.length) return findById(id)

  const r = await req.query(
    `UPDATE precios_proveedor SET ${sets.join(', ')} OUTPUT INSERTED.id WHERE id = @id`
  )
  if (!r.recordset.length) return null
  return findById(id)
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM precios_proveedor OUTPUT DELETED.id WHERE id = @id')
  return r.recordset.length > 0
}

export async function proveedorExists(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT TOP 1 id FROM proveedores WHERE id = @id')
  return r.recordset.length > 0
}

export async function piezaExists(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT TOP 1 id FROM piezas WHERE id = @id')
  return r.recordset.length > 0
}

// Una cotización por proveedor, refacción y día: lo mismo que impide el índice
// único, comprobado aquí para poder contestar con un mensaje entendible.
// `exceptId` deja fuera el registro que se está editando.
export async function existsMismoDia(
  proveedorId: number, piezaId: number, fecha: string, exceptId?: number
): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('pid',    sql.Int,  proveedorId)
    .input('pieza',  sql.Int,  piezaId)
    .input('fecha',  sql.Date, fecha)
    .input('except', sql.Int,  exceptId ?? null)
    .query(`
      SELECT TOP 1 id FROM precios_proveedor
      WHERE proveedor_id = @pid AND pieza_id = @pieza AND fecha = @fecha
        AND (@except IS NULL OR id <> @except)
    `)
  return r.recordset.length > 0
}

// ─── Comparativa global ─────────────────────────────────────────────────────

/**
 * Un precio comparable de una refacción con un proveedor: el vigente si lo
 * cotiza, y el de su última compra si se le compra. Un proveedor puede aportar
 * los dos, y son dos filas: cuál de ellos vale hoy lo decide el servicio.
 */
export interface PrecioComparable {
  pieza_id:      number
  numero_serie:  string
  descripcion:   string
  tipo_pieza:    string | null
  proveedor_id:  number
  proveedor:     string
  origen:        'cotizado' | 'pagado'
  /** Ya con el descuento aplicado: es el número que se compara. */
  precio:        number
  /** Lo que dice el papel, antes del descuento. */
  precio_lista:  number
  /**
   * El descuento con el que se llegó a `precio`. En una compra es el de su
   * factura —un hecho—; en una cotización, el de referencia —un supuesto—.
   * Null solo en una compra sin descuento.
   */
  descuento_pct: number | null
  fecha:         string
  /**
   * Cómo llegó ese proveedor a ese precio. `precio` es el vigente —el último
   * registro—, pero detrás suele haber más: con un solo proveedor en el
   * catálogo, la comparación entre columnas no existe y lo único que hay que
   * mirar es si el precio se movió.
   *
   * Una COMPRA es una factura, no un renglón: la misma refacción puede venir
   * repetida en varias partidas del mismo papel (así exporta el sistema del
   * proveedor, ver `docs/importacion-historica.md`), y contarlas como compras
   * distintas inventaría un cambio de precio de 0% contra sí misma.
   */
  registros:        number
  /** El registro inmediatamente anterior de esta misma fuente. */
  precio_anterior:  number | null
  fecha_anterior:   string | null
  /** El más viejo, para leer el recorrido completo y no solo el último salto. */
  precio_primero:   number
  fecha_primera:    string
}

/**
 * Un registro de precio suelto: una compra o una cotización, con su fecha.
 *
 * Es el grano que la comparativa resume. Ahí cada proveedor aparece una sola
 * vez —con lo último— porque la pregunta es a quién comprarle hoy; aquí no se
 * resume nada, porque la pregunta es cómo ha ido moviéndose el costo.
 */
export interface RegistroPrecio {
  proveedor_id:  number
  proveedor:     string
  origen:        'cotizado' | 'pagado'
  fecha:         string
  /** Ya con descuento: es el que se puede comparar con los demás. */
  precio:        number
  precio_lista:  number
  descuento_pct: number | null
  /** Solo en compras: de qué factura salió y cuántas piezas entraron a ese precio. */
  folio:         string | null
  cantidad:      number | null
}

/**
 * Todo lo que se sabe del precio de una refacción, registro por registro y de
 * lo más viejo a lo más nuevo.
 *
 * Una COMPRA es una factura, no un renglón, igual que en `findComparables`: el
 * mismo número de parte viene repetido en varias partidas del mismo papel, y
 * enseñarlas por separado pondría tres puntos idénticos el mismo día como si
 * fueran tres movimientos de precio. Las cantidades de esas partidas sí se
 * suman: son piezas que entraron de verdad a ese precio.
 */
export async function findHistorialPrecios(
  piezaId: number, descuentoRef = DESCUENTO_REFERENCIA,
): Promise<RegistroPrecio[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('pieza',   sql.Int,           piezaId)
    .input('descRef', sql.Decimal(5, 2), descuentoRef)
    .query(`
      WITH compras AS (
        SELECT fac.proveedor_id, fac.folio, fac.fecha_compra AS fecha,
               fac.descuento_pct,
               SUM(l.cantidad_inicial) AS cantidad,
               MAX(l.id)               AS lote_id
        FROM lotes_pieza l
        JOIN facturas fac ON fac.id = l.factura_id
        WHERE l.pieza_id = @pieza
        GROUP BY fac.proveedor_id, fac.folio, fac.fecha_compra, fac.descuento_pct
      )
      SELECT 'pagado' AS origen, c.proveedor_id, pr.nombre AS proveedor,
             CONVERT(char(10), c.fecha, 23) AS fecha,
             ${precioPagado('lo', 'c')} AS precio,
             lo.costo_unitario AS precio_lista,
             c.descuento_pct,
             c.folio, c.cantidad
      FROM compras c
      JOIN lotes_pieza  lo ON lo.id = c.lote_id
      JOIN proveedores  pr ON pr.id = c.proveedor_id

      UNION ALL

      SELECT 'cotizado' AS origen, pp.proveedor_id, pr.nombre AS proveedor,
             CONVERT(char(10), pp.fecha, 23) AS fecha,
             ${precioCotizado('pp')} AS precio,
             pp.precio AS precio_lista,
             @descRef  AS descuento_pct,
             CAST(NULL AS NVARCHAR(30)) AS folio,
             CAST(NULL AS INT)          AS cantidad
      FROM precios_proveedor pp
      JOIN proveedores pr ON pr.id = pp.proveedor_id
      WHERE pp.pieza_id = @pieza

      ORDER BY proveedor, fecha`)
  return r.recordset.map((row) => ({
    ...row,
    precio:        Number(row.precio),
    precio_lista:  Number(row.precio_lista),
    descuento_pct: row.descuento_pct == null ? null : Number(row.descuento_pct),
    cantidad:      row.cantidad == null ? null : Number(row.cantidad),
  }))
}

// La tabla completa: una fila por (refacción, proveedor, origen). Se devuelve
// larga y no pivoteada porque el número de proveedores no se sabe de antemano
// —pivotearla es trabajo del servicio— y con el origen a la vista porque una
// cotización y una compra no son lo mismo aunque se comparen: la primera es lo
// que ofrecen y la segunda lo que ya pasó.
//
// `piezaId` acota la consulta a una sola refacción: es la comparativa que se
// abre desde la pieza, y traerse el catálogo entero para quedarse con una fila
// sería pagar la tabla completa por una pregunta puntual.
export async function findComparables(
  piezaId?: number, descuentoRef = DESCUENTO_REFERENCIA,
): Promise<PrecioComparable[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('pieza',   sql.Int,           piezaId ?? null)
    .input('descRef', sql.Decimal(5, 2), descuentoRef)
    .query(`
    -- Un registro de precio por fuente, SIN elegir todavía cuál vale: el
    -- historial se calcula sobre todos y solo al final se toma el vigente.
    WITH cotizados AS (
      SELECT pp.proveedor_id, pp.pieza_id,
             ${precioCotizado('pp')} AS precio,
             pp.precio AS precio_lista,
             @descRef  AS descuento_pct,
             pp.fecha,
             -- Desempate dentro del mismo día: sin él, cuál es el vigente entre
             -- dos registros de la misma fecha lo decidiría el motor.
             pp.id AS orden
      FROM precios_proveedor pp
    ),
    -- Una COMPRA es una factura, no un renglón: la misma refacción viene
    -- repetida en varias partidas del mismo papel y contarlas por separado
    -- fabricaría un "cambio de precio" de 0% contra sí misma. Se toma el
    -- último lote de cada (factura, refacción), que es el precio que quedó.
    compras AS (
      SELECT fac.proveedor_id, l.pieza_id, l.factura_id,
             fac.fecha_compra AS fecha, fac.descuento_pct,
             MAX(l.id) AS lote_id
      FROM lotes_pieza l
      -- JOIN y no LEFT: el lote de recuperación (024) no salió de ninguna
      -- compra, vale $0 y no es el precio de nadie.
      JOIN facturas fac ON fac.id = l.factura_id
      GROUP BY fac.proveedor_id, l.pieza_id, l.factura_id, fac.fecha_compra, fac.descuento_pct
    ),
    pagados AS (
      SELECT c.proveedor_id, c.pieza_id,
             ${precioPagado('lo', 'c')} AS precio,
             lo.costo_unitario AS precio_lista,
             c.descuento_pct,
             c.fecha,
             c.lote_id AS orden
      FROM compras c
      JOIN lotes_pieza lo ON lo.id = c.lote_id
    ),
    -- El historial de cada (proveedor, refacción) dentro de su fuente: cuántos
    -- registros hay, cuál era el anterior y desde dónde viene. LEAD y no LAG
    -- porque el orden es descendente: el "siguiente" en esa lista es el previo
    -- en el tiempo.
    historial AS (
      SELECT origen, proveedor_id, pieza_id, precio, precio_lista, descuento_pct,
             fecha,
             ROW_NUMBER() OVER (PARTITION BY origen, proveedor_id, pieza_id
                                ORDER BY fecha DESC, orden DESC) AS rn,
             COUNT(*) OVER (PARTITION BY origen, proveedor_id, pieza_id) AS registros,
             LEAD(precio) OVER (PARTITION BY origen, proveedor_id, pieza_id
                                ORDER BY fecha DESC, orden DESC) AS precio_anterior,
             LEAD(fecha)  OVER (PARTITION BY origen, proveedor_id, pieza_id
                                ORDER BY fecha DESC, orden DESC) AS fecha_anterior,
             LAST_VALUE(precio) OVER (
               PARTITION BY origen, proveedor_id, pieza_id ORDER BY fecha DESC, orden DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS precio_primero,
             LAST_VALUE(fecha) OVER (
               PARTITION BY origen, proveedor_id, pieza_id ORDER BY fecha DESC, orden DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS fecha_primera
      FROM (
        SELECT 'cotizado' AS origen, * FROM cotizados
        UNION ALL
        SELECT 'pagado'   AS origen, * FROM pagados
      ) x
    ),
    todos AS (SELECT * FROM historial WHERE rn = 1)
    SELECT t.pieza_id, p.numero_serie, p.descripcion, tp.nombre AS tipo_pieza,
           t.proveedor_id, pr.nombre AS proveedor, t.origen,
           t.precio, t.precio_lista, t.descuento_pct,
           CONVERT(char(10), t.fecha, 23) AS fecha,
           t.registros, t.precio_anterior,
           CONVERT(char(10), t.fecha_anterior, 23) AS fecha_anterior,
           t.precio_primero,
           CONVERT(char(10), t.fecha_primera, 23) AS fecha_primera
    FROM todos t
    JOIN piezas      p  ON p.id  = t.pieza_id
    JOIN proveedores pr ON pr.id = t.proveedor_id
    LEFT JOIN tipos_pieza tp ON tp.id = p.tipo_pieza_id
    WHERE (@pieza IS NULL OR t.pieza_id = @pieza)
    ORDER BY p.descripcion, p.numero_serie, t.precio
  `)
  // mssql devuelve DECIMAL como string cuando no cabe en un number seguro; aquí
  // siempre cabe, pero se normaliza para no dejar al consumidor adivinando.
  return r.recordset.map((row) => ({
    ...row,
    precio:          Number(row.precio),
    precio_lista:    Number(row.precio_lista),
    descuento_pct:   row.descuento_pct == null ? null : Number(row.descuento_pct),
    registros:       Number(row.registros),
    precio_anterior: row.precio_anterior == null ? null : Number(row.precio_anterior),
    precio_primero:  Number(row.precio_primero),
  }))
}
