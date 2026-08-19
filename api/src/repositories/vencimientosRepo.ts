// Documentos que expiran dentro de un rango de fechas: seguros, permisos de
// circulación y tenencias.
//
// El tablero ya tenía sus propias consultas de "por vencer", pero preguntan
// otra cosa: `fecha_expiracion <= @limite` — todo lo que vence de aquí a treinta
// días, arrastrando lo ya vencido. El calendario necesita justo lo contrario:
// qué cae exactamente en el mes que se está viendo, sea el próximo o uno de
// hace un año. De ahí un rango cerrado en vez de un límite superior.
//
// Las licencias de conductor no están aquí: su vigencia es varchar (hay tarjetas
// que solo traen el año, o "3 AÑOS"), así que no se pueden filtrar en SQL. El
// service las lee con `parseVigencia` y las mete al rango ya interpretadas.
import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { JOINS_HIJAS, NO_DADO_DE_BAJA, PERMISO_ID_SQL, SEGURO_ID_SQL } from './vehiculosSql'

// Misma definición de flota que usa el tablero: lo que no está dado de baja. Un
// documento de una unidad de baja ya no se va a renovar y solo sería ruido.
const FLOTA_EN_OPERACION = `
  flota AS (
    SELECT v.id,
           ${SEGURO_ID_SQL}  AS seguro_id,
           ${PERMISO_ID_SQL} AS permiso_id
    FROM vehiculos v
    ${JOINS_HIJAS}
    WHERE ${NO_DADO_DE_BAJA}
  )
`

export interface SeguroVence {
  id:               number
  poliza:           string
  compania:         string
  fecha_expiracion: string
  vehiculos:        number
}

export async function findSegurosEnRango(start: string, end: string): Promise<SeguroVence[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('start', sql.Date, start)
    .input('end',   sql.Date, end)
    .query(`
      WITH ${FLOTA_EN_OPERACION}
      SELECT s.id, s.poliza, s.compania,
             CONVERT(char(10), s.fecha_expiracion, 23) AS fecha_expiracion,
             COUNT(v.id) AS vehiculos
      FROM seguros s
      LEFT JOIN flota v ON v.seguro_id = s.id
      WHERE s.fecha_expiracion BETWEEN @start AND @end
      GROUP BY s.id, s.poliza, s.compania, s.fecha_expiracion
      ORDER BY s.fecha_expiracion`)
  return r.recordset
}

export interface PermisoVence {
  id:               number
  zona_circulacion: string
  fecha_expiracion: string
  vehiculos:        number
}

export async function findPermisosEnRango(start: string, end: string): Promise<PermisoVence[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('start', sql.Date, start)
    .input('end',   sql.Date, end)
    .query(`
      WITH ${FLOTA_EN_OPERACION}
      SELECT p.id, p.zona_circulacion,
             CONVERT(char(10), p.fecha_expiracion, 23) AS fecha_expiracion,
             COUNT(v.id) AS vehiculos
      FROM permisos_circulacion p
      LEFT JOIN flota v ON v.permiso_id = p.id
      WHERE p.fecha_expiracion BETWEEN @start AND @end
      GROUP BY p.id, p.zona_circulacion, p.fecha_expiracion
      ORDER BY p.fecha_expiracion`)
  return r.recordset
}

export interface TenenciaVence {
  vehiculo_id:      number
  vehiculo:         string
  placas:           string | null
  tipo:             string
  fecha_expiracion: string
}

// La tenencia vive en las dos tablas hijas de los tipos que la pagan (reparto y
// utilitarios); tractocamiones, cajas y montacargas no la llevan.
export async function findTenenciasEnRango(start: string, end: string): Promise<TenenciaVence[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('start', sql.Date, start)
    .input('end',   sql.Date, end)
    .query(`
      WITH tenencias AS (
        SELECT vehiculo_id, tenencia_expiracion, status FROM camiones
        UNION ALL
        SELECT vehiculo_id, tenencia_expiracion, status FROM vehiculos_utilitarios
      )
      SELECT v.id AS vehiculo_id,
             CONCAT(m.marca, ' ', m.nombre, ' — ', v.numero_serie) AS vehiculo,
             v.placas, v.tipo,
             CONVERT(char(10), t.tenencia_expiracion, 23) AS fecha_expiracion
      FROM tenencias t
      JOIN vehiculos v ON v.id = t.vehiculo_id
      JOIN modelos   m ON m.id = v.modelo_id
      WHERE t.tenencia_expiracion BETWEEN @start AND @end
        AND COALESCE(t.status, '') <> 'Baja'
      ORDER BY t.tenencia_expiracion`)
  return r.recordset
}
