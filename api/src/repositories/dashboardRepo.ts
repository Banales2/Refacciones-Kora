import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface MantenimientoMes {
  id:               number
  vehiculo_id:      number
  vehiculo_nombre:  string
  vehiculo_tipo:    string
  fecha:            string
  costo:            number
  piezas_total:     number
}

export async function findMantenimientosEnRango(start: string, end: string): Promise<MantenimientoMes[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('start', sql.Date, start)
    .input('end',   sql.Date, end)
    .query(`
      SELECT m.id, m.vehiculo_id, CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo_nombre,
             v.tipo AS vehiculo_tipo,
             m.fecha, m.costo, COALESCE(pt.piezas_total, 0) AS piezas_total
      FROM mantenimiento m
      JOIN vehiculos v ON v.id = m.vehiculo_id
      JOIN modelos mo ON mo.id = v.modelo_id
      LEFT JOIN (
        SELECT mantenimiento_id, SUM(cantidad * costo_unitario) AS piezas_total
        FROM detalle_mtto_pieza
        GROUP BY mantenimiento_id
      ) pt ON pt.mantenimiento_id = m.id
      WHERE m.fecha >= @start AND m.fecha < @end
      ORDER BY m.fecha DESC
    `)
  return r.recordset
}

export interface MantenimientoCalendario {
  id:               number
  vehiculo_id:      number
  vehiculo_nombre:  string
  vehiculo_tipo:    string
  tipo:             string | null
  tecnico:          string | null
  fecha:            string
  costo:            number
  piezas_total:     number
}

export async function findAllMantenimientosConVehiculo(): Promise<MantenimientoCalendario[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT m.id, m.vehiculo_id, CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo_nombre,
           v.tipo AS vehiculo_tipo, m.tipo, m.tecnico,
           m.fecha, m.costo, COALESCE(pt.piezas_total, 0) AS piezas_total
    FROM mantenimiento m
    JOIN vehiculos v ON v.id = m.vehiculo_id
    JOIN modelos mo ON mo.id = v.modelo_id
    LEFT JOIN (
      SELECT mantenimiento_id, SUM(cantidad * costo_unitario) AS piezas_total
      FROM detalle_mtto_pieza
      GROUP BY mantenimiento_id
    ) pt ON pt.mantenimiento_id = m.id
    ORDER BY m.fecha DESC
  `)
  return r.recordset
}

export interface LoteMes {
  id:               number
  pieza_id:         number
  numero_serie:     string
  descripcion:      string
  proveedor:        string
  fecha_compra:     string
  cantidad_inicial: number
  costo_unitario:   number
}

export async function findLotesEnRango(start: string, end: string): Promise<LoteMes[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('start', sql.Date, start)
    .input('end',   sql.Date, end)
    .query(`
      SELECT l.id, l.pieza_id, p.numero_serie, p.descripcion, pr.nombre AS proveedor,
             l.fecha_compra, l.cantidad_inicial, l.costo_unitario
      FROM lotes_pieza l
      JOIN piezas p ON p.id = l.pieza_id
      JOIN proveedores pr ON pr.id = l.proveedor_id
      WHERE l.fecha_compra >= @start AND l.fecha_compra < @end
      ORDER BY l.fecha_compra DESC
    `)
  return r.recordset
}

export interface RequerimientoFleet {
  id:              number
  nombre:          string
  categoria:       string | null
  trigger_mode:    'km' | 'meses' | 'ambos'
  intervalo_km:    number | null
  intervalo_meses: number | null
  fecha_inicio:    string | null
  km_inicio:       number | null
  vehiculo_id:     number
  vehiculo_nombre: string
  kilometraje:     number | null
  fecha_compra:    string | null
}

export async function findRequerimientosActivosFleet(): Promise<RequerimientoFleet[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT r.id, r.nombre, r.categoria, r.trigger_mode, r.intervalo_km, r.intervalo_meses,
           r.fecha_inicio, r.km_inicio, r.vehiculo_id,
           CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo_nombre,
           CASE WHEN v.tipo='camion'       THEN c.kilometraje
                WHEN v.tipo='tractocamion' THEN t.kilometraje
                WHEN v.tipo='utilitario'   THEN u.kilometraje
                ELSE NULL END AS kilometraje,
           v.fecha_compra
    FROM requerimientos_exclusivos r
    JOIN vehiculos v ON v.id = r.vehiculo_id
    JOIN modelos mo ON mo.id = v.modelo_id
    LEFT JOIN camiones             c ON c.vehiculo_id = v.id
    LEFT JOIN tractocamiones       t ON t.vehiculo_id = v.id
    LEFT JOIN vehiculos_utilitarios u ON u.vehiculo_id = v.id
    WHERE r.status = 'activo'
  `)
  return r.recordset
}

export interface MantenimientoLink {
  requerimiento_id: number
  fecha:            string
  km_actual:        number
}

export async function findMantenimientoLinks(requerimientoIds: number[]): Promise<MantenimientoLink[]> {
  if (requerimientoIds.length === 0) return []
  const pool = await getPool()
  const ids = requerimientoIds.join(',')
  const r = await pool.request().query(`
    SELECT mr.requerimiento_id, m.fecha, m.km_actual
    FROM mantenimiento_requerimientos mr
    JOIN mantenimiento m ON m.id = mr.mantenimiento_id
    WHERE mr.requerimiento_id IN (${ids})
      AND m.fecha <= CAST(GETDATE() AS DATE)
    ORDER BY m.fecha DESC
  `)
  return r.recordset
}

export interface CostoVehiculoMes {
  vehiculo_id:           number
  mantenimientos_count:  number
  costo_mano_obra:       number
  costo_piezas:          number
  ultimo_mantenimiento:  string | Date | null
}

export async function findCostosPorVehiculoEnRango(start: string, end: string): Promise<CostoVehiculoMes[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('start', sql.Date, start)
    .input('end',   sql.Date, end)
    .query(`
      SELECT m.vehiculo_id,
             COUNT(*) AS mantenimientos_count,
             SUM(m.costo) AS costo_mano_obra,
             SUM(COALESCE(pt.piezas_total, 0)) AS costo_piezas,
             MAX(m.fecha) AS ultimo_mantenimiento
      FROM mantenimiento m
      LEFT JOIN (
        SELECT mantenimiento_id, SUM(cantidad * costo_unitario) AS piezas_total
        FROM detalle_mtto_pieza
        GROUP BY mantenimiento_id
      ) pt ON pt.mantenimiento_id = m.id
      WHERE m.fecha >= @start AND m.fecha < @end
      GROUP BY m.vehiculo_id
    `)
  return r.recordset
}

export async function countRequerimientosUnicosCreados(start: string, end: string): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('start', sql.Date, start)
    .input('end',   sql.Date, end)
    .query(`
      SELECT COUNT(*) AS total
      FROM requerimientos_exclusivos
      WHERE tipo = 'unica' AND created_at >= @start AND created_at < @end
    `)
  return r.recordset[0].total
}

export interface HistorialDia {
  fecha:      string
  vencidos:   number
  por_vencer: number
}

export async function upsertSnapshotHistorial(fecha: string, vencidos: number, porVencer: number): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('fecha',     sql.Date, fecha)
    .input('vencidos',  sql.Int,  vencidos)
    .input('porVencer', sql.Int,  porVencer)
    .query(`
      MERGE dashboard_requerimientos_historial AS target
      USING (SELECT @fecha AS fecha) AS src
      ON target.fecha = src.fecha
      WHEN MATCHED THEN
        UPDATE SET vencidos = @vencidos, por_vencer = @porVencer
      WHEN NOT MATCHED THEN
        INSERT (fecha, vencidos, por_vencer) VALUES (@fecha, @vencidos, @porVencer);
    `)
}

export async function findHistorial(start: string, end: string): Promise<HistorialDia[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('start', sql.Date, start)
    .input('end',   sql.Date, end)
    .query(`
      SELECT fecha, vencidos, por_vencer
      FROM dashboard_requerimientos_historial
      WHERE fecha >= @start AND fecha < @end
      ORDER BY fecha ASC
    `)
  return r.recordset
}

// Snapshot diario más cercano a `fecha` (dentro de `toleranciaDias`), para
// comparaciones periodo-contra-periodo cuando no hay snapshot exacto de ese día.
export async function findHistorialCercano(fecha: string, toleranciaDias = 3): Promise<HistorialDia | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('fecha', sql.Date, fecha)
    .input('tol',   sql.Int,  toleranciaDias)
    .query(`
      SELECT TOP 1 fecha, vencidos, por_vencer
      FROM dashboard_requerimientos_historial
      WHERE ABS(DATEDIFF(day, fecha, @fecha)) <= @tol
      ORDER BY ABS(DATEDIFF(day, fecha, @fecha)) ASC
    `)
  return r.recordset[0] ?? null
}
