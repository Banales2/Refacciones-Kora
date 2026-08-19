// Todo lo que la flota registró en un día concreto, y el mismo conteo agregado
// por día para pintar el calendario del mes.
//
// La página Calendario mostraba solo mantenimientos y agendas, pero la base
// fecha muchas más cosas: recargas, vales, incidencias, compras de refacciones
// y traspasos entre sucursales. Todas viven en tablas distintas sin nada en
// común salvo la fecha, así que cada una trae su propia consulta y el service
// las junta.
//
// Ojo con qué cuenta como "gasto del día": mano de obra (mantenimiento.costo),
// refacciones **compradas** (lotes_pieza) y combustible (recargas). Las piezas
// consumidas por un mantenimiento NO entran — ya se pagaron al comprarlas y
// sumarlas otra vez duplicaría el gasto. Es el mismo criterio de
// `costo_total_periodo` en el resumen del mes y de `findGastoMensual`.
import * as sql from 'mssql'
import { getPool } from '../shared/db'

const VEHICULO_NOMBRE = `CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie)`

// ─── Mantenimientos realizados ───────────────────────────────────────────────

export interface MantenimientoDia {
  id:              number
  vehiculo_id:     number
  vehiculo_nombre: string
  vehiculo_tipo:   string
  tipo:            string | null
  tecnico:         string | null
  costo:           number
  piezas_total:    number
  km_actual:       number | null
  observaciones:   string | null
}

export async function findMantenimientosDelDia(fecha: string): Promise<MantenimientoDia[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('fecha', sql.Date, fecha)
    .query(`
      SELECT m.id, m.vehiculo_id, ${VEHICULO_NOMBRE} AS vehiculo_nombre,
             v.tipo AS vehiculo_tipo, m.tipo, t.nombre AS tecnico,
             m.costo, COALESCE(pt.piezas_total, 0) AS piezas_total,
             m.km_actual, m.observaciones
      FROM mantenimiento m
      JOIN vehiculos v ON v.id = m.vehiculo_id
      JOIN modelos mo  ON mo.id = v.modelo_id
      LEFT JOIN tecnicos t ON t.id = m.tecnico_id
      LEFT JOIN (
        SELECT mantenimiento_id, SUM(cantidad * costo_unitario) AS piezas_total
        FROM detalle_mtto_pieza
        GROUP BY mantenimiento_id
      ) pt ON pt.mantenimiento_id = m.id
      WHERE m.fecha = @fecha
      ORDER BY vehiculo_nombre
    `)
  return r.recordset
}

// ─── Recargas de combustible ─────────────────────────────────────────────────

export interface RecargaDia {
  id:              number
  vehiculo_id:     number
  vehiculo_nombre: string
  vehiculo_tipo:   string
  gasolinera:      string
  ubicacion:       string
  conductor:       string
  litros:          number
  costo:           number
  kilometraje:     number | null
  vale_folio:      string | null
}

export async function findRecargasDelDia(fecha: string): Promise<RecargaDia[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('fecha', sql.Date, fecha)
    .query(`
      SELECT rc.id, rc.vehiculo_id, ${VEHICULO_NOMBRE} AS vehiculo_nombre,
             v.tipo AS vehiculo_tipo,
             g.nombre AS gasolinera, g.ubicacion, c.nombre AS conductor,
             rc.litros, rc.costo, rc.kilometraje, vg.folio AS vale_folio
      FROM recargas_combustible rc
      JOIN vehiculos v   ON v.id = rc.vehiculo_id
      JOIN modelos mo    ON mo.id = v.modelo_id
      JOIN gasolineras g ON g.id = rc.gasolinera_id
      JOIN conductores c ON c.id = rc.conductor_id
      LEFT JOIN vales_gasolina vg ON vg.id = rc.vale_id
      WHERE rc.fecha = @fecha
      ORDER BY rc.costo DESC
    `)
  return r.recordset
}

// ─── Vales de gasolina emitidos ──────────────────────────────────────────────

export interface ValeDia {
  id:              number
  folio:           string
  creado_por:      string
  conductor:       string
  vehiculo_id:     number
  vehiculo_nombre: string
  vehiculo_tipo:   string
  // Un vale emitido y no cobrado es papel suelto: se marca aparte para que
  // salte a la vista en el detalle del día.
  usado:           boolean
}

export async function findValesDelDia(fecha: string): Promise<ValeDia[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('fecha', sql.Date, fecha)
    .query(`
      SELECT vg.id, vg.folio, vg.creado_por, c.nombre AS conductor,
             vg.vehiculo_id, ${VEHICULO_NOMBRE} AS vehiculo_nombre, v.tipo AS vehiculo_tipo,
             CAST(CASE WHEN rc.id IS NULL THEN 0 ELSE 1 END AS bit) AS usado
      FROM vales_gasolina vg
      JOIN conductores c ON c.id = vg.conductor_id
      JOIN vehiculos v   ON v.id = vg.vehiculo_id
      JOIN modelos mo    ON mo.id = v.modelo_id
      LEFT JOIN recargas_combustible rc ON rc.vale_id = vg.id
      WHERE vg.fecha = @fecha
      ORDER BY vg.folio
    `)
  return r.recordset
}

// ─── Incidencias reportadas y cerradas ───────────────────────────────────────

export interface IncidenciaDia {
  id:              number
  vehiculo_id:     number
  vehiculo_nombre: string
  vehiculo_tipo:   string
  nombre:          string
  categoria:       string | null
  severidad:       string
  status:          string
  hora:            string | null
  ubicacion:       string
  reportado_por:   string
}

export async function findIncidenciasAbiertasDelDia(fecha: string): Promise<IncidenciaDia[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('fecha', sql.Date, fecha)
    .query(`
      SELECT p.id, p.vehiculo_id, ${VEHICULO_NOMBRE} AS vehiculo_nombre, v.tipo AS vehiculo_tipo,
             p.nombre, p.categoria, i.severidad, p.status,
             CONVERT(varchar(5), i.hora, 108) AS hora, i.ubicacion, i.reportado_por
      FROM pendientes p
      JOIN incidencias i ON i.id = p.id
      JOIN vehiculos v   ON v.id = p.vehiculo_id
      JOIN modelos mo    ON mo.id = v.modelo_id
      WHERE i.fecha = @fecha
      ORDER BY
        CASE i.severidad WHEN 'grave' THEN 0 WHEN 'moderada' THEN 1 ELSE 2 END,
        i.hora
    `)
  return r.recordset
}

// Una incidencia no guarda "fecha de cierre": se cierra cuando el mantenimiento
// que la atiende ya ocurrió (ver `syncIncidenciaStatuses` en pendientesRepo).
// Por eso el día del cierre es la fecha del vínculo `mantenimiento_pendientes`,
// que es un snapshot de la fecha del servicio y no se mueve después.
export interface IncidenciaCerradaDia extends IncidenciaDia {
  mantenimiento_id: number
}

export async function findIncidenciasCerradasDelDia(fecha: string): Promise<IncidenciaCerradaDia[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('fecha', sql.Date, fecha)
    .query(`
      SELECT p.id, p.vehiculo_id, ${VEHICULO_NOMBRE} AS vehiculo_nombre, v.tipo AS vehiculo_tipo,
             p.nombre, p.categoria, i.severidad, p.status,
             CONVERT(varchar(5), i.hora, 108) AS hora, i.ubicacion, i.reportado_por,
             mp.mantenimiento_id
      FROM mantenimiento_pendientes mp
      JOIN pendientes p  ON p.id = mp.pendiente_id
      JOIN incidencias i ON i.id = p.id
      JOIN vehiculos v   ON v.id = p.vehiculo_id
      JOIN modelos mo    ON mo.id = v.modelo_id
      WHERE mp.fecha = @fecha AND p.origen = 'incidencia' AND p.status = 'completado'
      ORDER BY p.nombre
    `)
  return r.recordset
}

// ─── Compras de refacciones ──────────────────────────────────────────────────

export interface CompraDia {
  id:               number
  pieza_id:         number
  numero_serie:     string
  descripcion:      string
  proveedor:        string
  sucursal:         string | null
  cantidad_inicial: number
  costo_unitario:   number
  num_factura:      string | null
  comprado_por:     string | null
}

export async function findComprasDelDia(fecha: string): Promise<CompraDia[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('fecha', sql.Date, fecha)
    .query(`
      SELECT l.id, l.pieza_id, p.numero_serie, p.descripcion,
             pr.nombre AS proveedor, s.nombre AS sucursal,
             l.cantidad_inicial, l.costo_unitario, l.num_factura, l.comprado_por
      FROM lotes_pieza l
      JOIN piezas p       ON p.id = l.pieza_id
      JOIN proveedores pr ON pr.id = l.proveedor_id
      LEFT JOIN sucursales s ON s.id = l.sucursal_id
      WHERE l.fecha_compra = @fecha
      ORDER BY (l.cantidad_inicial * l.costo_unitario) DESC
    `)
  return r.recordset
}

// ─── Traspasos entre sucursales ──────────────────────────────────────────────

export interface TraspasoDia {
  id:            number
  numero_serie:  string
  descripcion:   string
  origen:        string
  destino:       string
  cantidad:      number
  usuario_email: string | null
}

export async function findTraspasosDelDia(fecha: string): Promise<TraspasoDia[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('fecha', sql.Date, fecha)
    .query(`
      SELECT tr.id, p.numero_serie, p.descripcion,
             so.nombre AS origen, sd.nombre AS destino,
             tr.cantidad, tr.usuario_email
      FROM traspasos_pieza tr
      JOIN sucursales so ON so.id = tr.origen_sucursal_id
      JOIN sucursales sd ON sd.id = tr.destino_sucursal_id
      JOIN lotes_pieza l ON l.id = tr.lote_id
      JOIN piezas p      ON p.id = l.pieza_id
      WHERE tr.fecha = @fecha
      ORDER BY p.descripcion
    `)
  return r.recordset
}

// ─── Agregado por día, para el calendario del mes ────────────────────────────

export interface ActividadDia {
  dia:                  string   // 'YYYY-MM-DD'
  mantenimientos:       number
  recargas:             number
  vales:                number
  incidencias_abiertas: number
  incidencias_cerradas: number
  compras:              number
  traspasos:            number
  mano_obra:            number
  refacciones:          number
  combustible:          number
}

// Un UNION ALL en vez de siete consultas: el calendario necesita las siete
// cifras del mismo día en la misma fila, y un día con recargas pero sin
// mantenimientos tiene que salir igual, con las demás columnas en cero.
export async function findActividadPorDia(start: string, end: string): Promise<ActividadDia[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('start', sql.Date, start)
    .input('end',   sql.Date, end)
    .query(`
      SELECT dia,
             SUM(mantenimientos)       AS mantenimientos,
             SUM(recargas)             AS recargas,
             SUM(vales)                AS vales,
             SUM(incidencias_abiertas) AS incidencias_abiertas,
             SUM(incidencias_cerradas) AS incidencias_cerradas,
             SUM(compras)              AS compras,
             SUM(traspasos)            AS traspasos,
             SUM(mano_obra)            AS mano_obra,
             SUM(refacciones)          AS refacciones,
             SUM(combustible)          AS combustible
      FROM (
        SELECT CONVERT(char(10), m.fecha, 23) AS dia,
               1 AS mantenimientos, 0 AS recargas, 0 AS vales,
               0 AS incidencias_abiertas, 0 AS incidencias_cerradas,
               0 AS compras, 0 AS traspasos,
               m.costo                  AS mano_obra,
               CAST(0 AS DECIMAL(18,2)) AS refacciones,
               CAST(0 AS DECIMAL(18,2)) AS combustible
        FROM mantenimiento m
        WHERE m.fecha BETWEEN @start AND @end

        UNION ALL

        SELECT CONVERT(char(10), rc.fecha, 23), 0, 1, 0, 0, 0, 0, 0,
               CAST(0 AS DECIMAL(18,2)), CAST(0 AS DECIMAL(18,2)), rc.costo
        FROM recargas_combustible rc
        WHERE rc.fecha BETWEEN @start AND @end

        UNION ALL

        SELECT CONVERT(char(10), vg.fecha, 23), 0, 0, 1, 0, 0, 0, 0,
               CAST(0 AS DECIMAL(18,2)), CAST(0 AS DECIMAL(18,2)), CAST(0 AS DECIMAL(18,2))
        FROM vales_gasolina vg
        WHERE vg.fecha BETWEEN @start AND @end

        UNION ALL

        SELECT CONVERT(char(10), i.fecha, 23), 0, 0, 0, 1, 0, 0, 0,
               CAST(0 AS DECIMAL(18,2)), CAST(0 AS DECIMAL(18,2)), CAST(0 AS DECIMAL(18,2))
        FROM incidencias i
        WHERE i.fecha BETWEEN @start AND @end

        UNION ALL

        SELECT CONVERT(char(10), mp.fecha, 23), 0, 0, 0, 0, 1, 0, 0,
               CAST(0 AS DECIMAL(18,2)), CAST(0 AS DECIMAL(18,2)), CAST(0 AS DECIMAL(18,2))
        FROM mantenimiento_pendientes mp
        JOIN pendientes p ON p.id = mp.pendiente_id
        WHERE mp.fecha BETWEEN @start AND @end
          AND p.origen = 'incidencia' AND p.status = 'completado'

        UNION ALL

        SELECT CONVERT(char(10), l.fecha_compra, 23), 0, 0, 0, 0, 0, 1, 0,
               CAST(0 AS DECIMAL(18,2)), l.cantidad_inicial * l.costo_unitario, CAST(0 AS DECIMAL(18,2))
        FROM lotes_pieza l
        WHERE l.fecha_compra BETWEEN @start AND @end

        UNION ALL

        SELECT CONVERT(char(10), tr.fecha, 23), 0, 0, 0, 0, 0, 0, 1,
               CAST(0 AS DECIMAL(18,2)), CAST(0 AS DECIMAL(18,2)), CAST(0 AS DECIMAL(18,2))
        FROM traspasos_pieza tr
        WHERE tr.fecha BETWEEN @start AND @end
      ) x
      GROUP BY dia
      ORDER BY dia
    `)
  return r.recordset
}
