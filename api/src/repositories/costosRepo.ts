// Lecturas crudas para el análisis de costos del tablero. Aquí no se calcula
// nada: se traen los renglones (recargas, mantenimientos, compras) y el
// servicio los cruza. La razón es que casi todas las métricas de ahorro
// —rendimiento, costo por kilómetro, retrabajos— dependen de comparar un
// registro con el anterior del mismo vehículo, y eso en SQL sale ilegible y en
// TypeScript sale obvio.
import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { JOINS_HIJAS, NO_DADO_DE_BAJA } from './vehiculosSql'

// El odómetro vive en la tabla hija de cada tipo, igual que el status. Las
// cajas de trailer y los montacargas no lo llevan y quedan en NULL — no se
// arrastran a sí mismos, así que no tienen kilómetros que recorrer.
const KILOMETRAJE_SQL = `
  CASE WHEN v.tipo = 'camion'       THEN c.kilometraje
       WHEN v.tipo = 'tractocamion' THEN t.kilometraje
       WHEN v.tipo = 'utilitario'   THEN u.kilometraje
       ELSE NULL END
`

// ─── Recargas de combustible ────────────────────────────────────────────────

export interface RecargaCosto {
  id:              number
  vehiculo_id:     number
  vehiculo_nombre: string
  vehiculo_tipo:   string
  modelo_id:       number
  modelo_nombre:   string
  gasolinera_id:   number
  gasolinera:      string
  conductor_id:    number
  conductor:       string
  vale_id:         number | null
  fecha:           string
  litros:          number
  costo:           number
  kilometraje:     number | null
}

// Las recargas del rango, de la flota en operación, ordenadas por vehículo y
// fecha: así el servicio recorre cada unidad de corrido y compara cada carga
// con la anterior sin volver a ordenar.
export async function findRecargasEnRango(start: string, end: string): Promise<RecargaCosto[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('start', sql.Date, start)
    .input('end',   sql.Date, end)
    .query(`
      SELECT rc.id, rc.vehiculo_id,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo_nombre,
             v.tipo AS vehiculo_tipo,
             v.modelo_id, CONCAT(mo.marca, ' ', mo.nombre) AS modelo_nombre,
             rc.gasolinera_id, gs.nombre AS gasolinera,
             rc.conductor_id, co.nombre AS conductor,
             rc.vale_id,
             CONVERT(char(10), rc.fecha, 23) AS fecha,
             rc.litros, rc.costo, rc.kilometraje
      FROM recargas_combustible rc
      JOIN vehiculos   v  ON v.id  = rc.vehiculo_id
      JOIN modelos     mo ON mo.id = v.modelo_id
      JOIN gasolineras gs ON gs.id = rc.gasolinera_id
      JOIN conductores co ON co.id = rc.conductor_id
      ${JOINS_HIJAS}
      WHERE rc.fecha >= @start AND rc.fecha < @end
        AND ${NO_DADO_DE_BAJA}
      ORDER BY rc.vehiculo_id, rc.fecha, rc.id
    `)
  return r.recordset
}

// ─── Mantenimientos ─────────────────────────────────────────────────────────

export interface MantenimientoCosto {
  id:              number
  vehiculo_id:     number
  vehiculo_nombre: string
  vehiculo_tipo:   string
  fecha:           string
  tipo:            string | null
  costo:           number
  km_actual:       number | null
  piezas_total:    number
}

// Igual que el resumen del mes pero con `km_actual` y `tipo`: el kilometraje
// sirve para medir el recorrido del periodo (no todas las unidades cargan
// combustible con odómetro capturado) y el tipo, para detectar retrabajos.
export async function findMantenimientosEnRango(start: string, end: string): Promise<MantenimientoCosto[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('start', sql.Date, start)
    .input('end',   sql.Date, end)
    .query(`
      SELECT m.id, m.vehiculo_id,
             CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo_nombre,
             v.tipo AS vehiculo_tipo,
             CONVERT(char(10), m.fecha, 23) AS fecha,
             m.tipo, m.costo, m.km_actual,
             COALESCE(pt.piezas_total, 0) AS piezas_total
      FROM mantenimiento m
      JOIN vehiculos v  ON v.id  = m.vehiculo_id
      JOIN modelos   mo ON mo.id = v.modelo_id
      ${JOINS_HIJAS}
      LEFT JOIN (
        SELECT mantenimiento_id, SUM(cantidad * costo_unitario) AS piezas_total
        FROM detalle_mtto_pieza
        GROUP BY mantenimiento_id
      ) pt ON pt.mantenimiento_id = m.id
      WHERE m.fecha >= @start AND m.fecha < @end
        AND ${NO_DADO_DE_BAJA}
      ORDER BY m.vehiculo_id, m.fecha, m.id
    `)
  return r.recordset
}

// ─── Compras contra el mejor precio cotizado ────────────────────────────────

export interface CompraComparada {
  lote_id:            number
  pieza_id:           number
  numero_serie:       string
  descripcion:        string
  proveedor_id:       number
  proveedor:          string
  fecha_compra:       string
  cantidad:           number
  costo_unitario:     number
  /** Precio vigente más bajo entre todos los proveedores. null si nadie la cotiza. */
  mejor_precio:       number | null
  mejor_proveedor_id: number | null
  mejor_proveedor:    string | null
}

// Cada compra del rango junto al mejor precio vigente que hay cotizado para esa
// refacción. "Vigente" = la cotización más reciente de cada proveedor; de esas,
// la más barata. Se compara contra el precio de la cotización más reciente y no
// contra la que estaba viva el día de la compra: lo que interesa no es auditar
// el pasado sino saber a qué precio se puede comprar la próxima vez.
export async function findComprasComparadas(start: string, end: string): Promise<CompraComparada[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('start', sql.Date, start)
    .input('end',   sql.Date, end)
    .query(`
      WITH vigente AS (
        SELECT pp.pieza_id, pp.proveedor_id, pp.precio,
               ROW_NUMBER() OVER (
                 PARTITION BY pp.pieza_id, pp.proveedor_id
                 ORDER BY pp.fecha DESC, pp.id DESC
               ) AS rn
        FROM precios_proveedor pp
      ),
      mejor AS (
        SELECT v.pieza_id, v.proveedor_id, v.precio,
               ROW_NUMBER() OVER (
                 PARTITION BY v.pieza_id
                 ORDER BY v.precio ASC, v.proveedor_id ASC
               ) AS rn
        FROM vigente v
        WHERE v.rn = 1
      )
      SELECT l.id AS lote_id, l.pieza_id, p.numero_serie, p.descripcion,
             pr.id AS proveedor_id, pr.nombre AS proveedor,
             CONVERT(char(10), l.fecha_compra, 23) AS fecha_compra,
             l.cantidad_inicial AS cantidad, l.costo_unitario,
             mj.precio       AS mejor_precio,
             mj.proveedor_id AS mejor_proveedor_id,
             prm.nombre      AS mejor_proveedor
      FROM lotes_pieza l
      JOIN piezas      p  ON p.id  = l.pieza_id
      JOIN proveedores pr ON pr.id = l.proveedor_id
      LEFT JOIN mejor  mj  ON mj.pieza_id = l.pieza_id AND mj.rn = 1
      LEFT JOIN proveedores prm ON prm.id = mj.proveedor_id
      WHERE l.fecha_compra >= @start AND l.fecha_compra < @end
      ORDER BY l.fecha_compra DESC, l.id DESC
    `)
  return r.recordset
}

// ─── Gasto mensual ──────────────────────────────────────────────────────────

export interface GastoMes {
  mes:          string   // 'YYYY-MM'
  mano_obra:    number
  refacciones:  number
  combustible:  number
}

// Las tres fuentes de gasto por mes calendario. Se suman con UNION ALL en vez
// de tres consultas porque el eje del gráfico es el mismo: un mes sin compras
// pero con combustible tiene que salir igual, con la columna en cero.
//
// Ojo con qué se suma: las refacciones son las **compradas** (`lotes_pieza`),
// no las consumidas por los mantenimientos — esas ya se pagaron al comprarlas y
// contarlas otra vez duplicaría el gasto. Es el mismo criterio de
// `costo_total_periodo` en el resumen del mes.
export async function findGastoMensual(desde: string): Promise<GastoMes[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('desde', sql.Date, desde)
    .query(`
      SELECT mes,
             SUM(mano_obra)   AS mano_obra,
             SUM(refacciones) AS refacciones,
             SUM(combustible) AS combustible
      FROM (
        SELECT CONVERT(char(7), m.fecha, 126) AS mes,
               m.costo                        AS mano_obra,
               CAST(0 AS DECIMAL(18,2))       AS refacciones,
               CAST(0 AS DECIMAL(18,2))       AS combustible
        FROM mantenimiento m
        WHERE m.fecha >= @desde

        UNION ALL

        SELECT CONVERT(char(7), l.fecha_compra, 126),
               CAST(0 AS DECIMAL(18,2)),
               l.cantidad_inicial * l.costo_unitario,
               CAST(0 AS DECIMAL(18,2))
        FROM lotes_pieza l
        WHERE l.fecha_compra >= @desde

        UNION ALL

        SELECT CONVERT(char(7), rc.fecha, 126),
               CAST(0 AS DECIMAL(18,2)),
               CAST(0 AS DECIMAL(18,2)),
               rc.costo
        FROM recargas_combustible rc
        WHERE rc.fecha >= @desde
      ) x
      GROUP BY mes
      ORDER BY mes
    `)
  return r.recordset
}

// ─── Flota en operación ─────────────────────────────────────────────────────

export interface VehiculoFlota {
  vehiculo_id: number
  vehiculo:    string
  tipo:        string
  modelo_id:   number
  modelo:      string
  kilometraje: number | null
}

// La flota viva, para poder reportar también a las unidades que **no** tuvieron
// gasto en el periodo: un vehículo parado no aparece en ninguna de las tablas
// de arriba, y justo ese es el que hay que ver.
export async function findFlotaEnOperacion(): Promise<VehiculoFlota[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT v.id AS vehiculo_id,
           CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo,
           v.tipo, v.modelo_id, CONCAT(mo.marca, ' ', mo.nombre) AS modelo,
           ${KILOMETRAJE_SQL} AS kilometraje
    FROM vehiculos v
    JOIN modelos mo ON mo.id = v.modelo_id
    ${JOINS_HIJAS}
    WHERE ${NO_DADO_DE_BAJA}
    ORDER BY v.tipo, mo.marca, mo.nombre, v.numero_serie
  `)
  return r.recordset
}
