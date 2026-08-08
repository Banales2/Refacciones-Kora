import * as sql from 'mssql'
import { getPool } from '../shared/db'

// ─── Seguros / permisos por vencer ──────────────────────────────────────────
export interface SeguroPorVencer {
  id:               number
  poliza:           string
  compania:         string
  fecha_expiracion: string
  vehiculos:        number
}

export interface PermisoPorVencer {
  id:               number
  zona_circulacion: string
  fecha_expiracion: string
  vehiculos:        number
}

// Seguros cuya fecha de expiración es <= @limite (incluye ya vencidos), con el
// conteo de vehículos que los usan.
export async function findSegurosPorVencer(limite: string): Promise<SeguroPorVencer[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('limite', sql.Date, limite)
    .query(`
      SELECT s.id, s.poliza, s.compania,
             CONVERT(char(10), s.fecha_expiracion, 23) AS fecha_expiracion,
             COUNT(v.id) AS vehiculos
      FROM seguros s
      LEFT JOIN vehiculos v ON v.seguro_id = s.id
      WHERE s.fecha_expiracion <= @limite
      GROUP BY s.id, s.poliza, s.compania, s.fecha_expiracion
      ORDER BY s.fecha_expiracion`)
  return r.recordset
}

// Tenencias por vencer. Vive en las tres tablas hijas de los tipos que la
// pagan (reparto, tractocamiones y utilitarios), así que se unen aquí; cajas de
// trailer y montacargas no tienen esas columnas porque no la llevan.
export interface TenenciaPorVencer {
  vehiculo_id:      number
  vehiculo:         string
  placas:           string | null
  tipo:             string
  folio:            string | null
  fecha_expiracion: string
}

export async function findTenenciasPorVencer(limite: string): Promise<TenenciaPorVencer[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('limite', sql.Date, limite)
    .query(`
      WITH tenencias AS (
        SELECT vehiculo_id, tenencia, tenencia_expiracion FROM camiones
        UNION ALL
        SELECT vehiculo_id, tenencia, tenencia_expiracion FROM tractocamiones
        UNION ALL
        SELECT vehiculo_id, tenencia, tenencia_expiracion FROM vehiculos_utilitarios
      )
      SELECT v.id AS vehiculo_id,
             CONCAT(m.marca, ' ', m.nombre, ' — ', v.numero_serie) AS vehiculo,
             v.placas, v.tipo, t.tenencia AS folio,
             CONVERT(char(10), t.tenencia_expiracion, 23) AS fecha_expiracion
      FROM tenencias t
      JOIN vehiculos v ON v.id = t.vehiculo_id
      JOIN modelos   m ON m.id = v.modelo_id
      WHERE t.tenencia_expiracion IS NOT NULL
        AND t.tenencia_expiracion <= @limite
      ORDER BY t.tenencia_expiracion`)
  return r.recordset
}

export async function findPermisosPorVencer(limite: string): Promise<PermisoPorVencer[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('limite', sql.Date, limite)
    .query(`
      SELECT p.id, p.zona_circulacion,
             CONVERT(char(10), p.fecha_expiracion, 23) AS fecha_expiracion,
             COUNT(v.id) AS vehiculos
      FROM permisos_circulacion p
      LEFT JOIN vehiculos v ON v.permiso_id = p.id
      WHERE p.fecha_expiracion <= @limite
      GROUP BY p.id, p.zona_circulacion, p.fecha_expiracion
      ORDER BY p.fecha_expiracion`)
  return r.recordset
}

// Vigencias de licencia capturadas. Se filtran y comparan en el servicio, no
// en SQL, porque la columna es varchar (el formato de la vigencia varía) y una
// comparación de fechas aquí descartaría filas válidas.
export interface LicenciaConductor {
  id:                          number
  nombre:                      string
  licencia_estatal_numero:     string | null
  licencia_estatal_vigencia:   string | null
  licencia_federal_numero:     string | null
  licencia_federal_vigencia:   string | null
  licencia_federal_expediente:          string | null
  licencia_federal_expediente_vigencia: string | null
}

export async function findConductoresConVigencia(): Promise<LicenciaConductor[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT id, nombre,
           licencia_estatal_numero, licencia_estatal_vigencia,
           licencia_federal_numero, licencia_federal_vigencia,
           licencia_federal_expediente, licencia_federal_expediente_vigencia
    FROM conductores
    WHERE licencia_estatal_vigencia IS NOT NULL
       OR licencia_federal_vigencia IS NOT NULL
       OR licencia_federal_expediente_vigencia IS NOT NULL
    ORDER BY nombre`)
  return r.recordset
}

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
           v.tipo AS vehiculo_tipo, m.tipo, t.nombre AS tecnico,
           m.fecha, m.costo, COALESCE(pt.piezas_total, 0) AS piezas_total
    FROM mantenimiento m
    JOIN vehiculos v ON v.id = m.vehiculo_id
    LEFT JOIN tecnicos t ON t.id = m.tecnico_id
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
    SELECT p.id, p.nombre, p.categoria, r.trigger_mode, r.intervalo_km, r.intervalo_meses,
           r.fecha_inicio, r.km_inicio, p.vehiculo_id,
           CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo_nombre,
           CASE WHEN v.tipo='camion'       THEN c.kilometraje
                WHEN v.tipo='tractocamion' THEN t.kilometraje
                WHEN v.tipo='utilitario'   THEN u.kilometraje
                ELSE NULL END AS kilometraje,
           v.fecha_compra
    FROM pendientes p
    JOIN requerimientos_exclusivos r ON r.id = p.id
    JOIN vehiculos v ON v.id = p.vehiculo_id
    JOIN modelos mo ON mo.id = v.modelo_id
    LEFT JOIN camiones             c ON c.vehiculo_id = v.id
    LEFT JOIN tractocamiones       t ON t.vehiculo_id = v.id
    LEFT JOIN vehiculos_utilitarios u ON u.vehiculo_id = v.id
    WHERE p.status = 'activo'
  `)
  return r.recordset
}

export interface IncidenciaAbiertaFleet {
  id:              number
  nombre:          string
  categoria:       string | null
  severidad:       'superficial' | 'moderada' | 'grave'
  fecha:           string
  vehiculo_id:     number
  vehiculo_nombre: string
}

// Incidencias sin atender de toda la flota. Las canceladas quedan fuera: siguen
// existiendo como registro, pero dejaron de ser algo pendiente.
export async function findIncidenciasAbiertasFleet(): Promise<IncidenciaAbiertaFleet[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT p.id, p.nombre, p.categoria, i.severidad, i.fecha, p.vehiculo_id,
           CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo_nombre
    FROM pendientes p
    JOIN incidencias i ON i.id = p.id
    JOIN vehiculos v   ON v.id = p.vehiculo_id
    JOIN modelos mo    ON mo.id = v.modelo_id
    WHERE p.status = 'activo'
    ORDER BY CASE i.severidad WHEN 'grave' THEN 0 WHEN 'moderada' THEN 1 ELSE 2 END,
             i.fecha
  `)
  return r.recordset
}

export interface MantenimientoLink {
  pendiente_id: number
  fecha:        string
  km_actual:    number | null
}

// El km y la fecha salen del propio vínculo, no del mantenimiento: son los que
// se congelaron cuando se atendió el pendiente.
export async function findMantenimientoLinks(pendienteIds: number[]): Promise<MantenimientoLink[]> {
  if (pendienteIds.length === 0) return []
  const pool = await getPool()
  const req = pool.request()
  const params = pendienteIds.map((id, i) => {
    req.input(`r${i}`, sql.Int, id)
    return `@r${i}`
  })
  const r = await req.query(`
    SELECT mp.pendiente_id, mp.fecha, mp.km_actual
    FROM mantenimiento_pendientes mp
    WHERE mp.pendiente_id IN (${params.join(',')})
      AND mp.fecha <= CAST(GETDATE() AS DATE)
    ORDER BY mp.fecha DESC
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
