import * as sql from 'mssql'
import { getPool } from '../shared/db'

export type TriggerMode  = 'km' | 'meses' | 'ambos'
export type TipoReq      = 'recurrente' | 'unica'
export type StatusReq    = 'activo' | 'completado' | 'pausado' | 'cancelado'

export interface RequerimientoExclusivo {
  id:                  number
  nombre:              string
  descripcion:         string | null
  categoria:           string | null
  intervalo_km:        number | null
  intervalo_meses:     number | null
  intervalo_dias:      number | null
  trigger_mode:        TriggerMode
  tipo:                TipoReq
  status:              StatusReq
  created_at:          string
  updated_at:          string
  vehiculo_id:         number
  plantilla_origen_id: number | null
  fecha_inicio:        string | null
  km_inicio:           number | null
  fecha_reporte:       string | null
}

export interface RequerimientoCreate {
  vehiculo_id:          number
  nombre:               string
  descripcion?:         string | null
  categoria?:           string | null
  trigger_mode:         TriggerMode
  tipo?:                TipoReq
  intervalo_km?:        number | null
  intervalo_meses?:     number | null
  intervalo_dias?:      number | null
  status?:              StatusReq
  plantilla_origen_id?: number | null
  fecha_inicio?:        string | null
  km_inicio?:           number | null
  fecha_reporte?:       string | null
}

export interface RequerimientoUpdate {
  nombre?:          string
  descripcion?:     string | null
  categoria?:       string | null
  trigger_mode?:    TriggerMode
  tipo?:            TipoReq
  intervalo_km?:    number | null
  intervalo_meses?: number | null
  intervalo_dias?:  number | null
  status?:          StatusReq
  fecha_inicio?:    string | null
  km_inicio?:       number | null
  fecha_reporte?:   string | null
}

const COLS = `id, nombre, descripcion, categoria, intervalo_km, intervalo_meses, intervalo_dias,
  trigger_mode, tipo, status, created_at, updated_at, vehiculo_id, plantilla_origen_id,
  fecha_inicio, km_inicio, fecha_reporte`

export async function findByVehiculo(vehiculoId: number): Promise<RequerimientoExclusivo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`SELECT ${COLS} FROM requerimientos_exclusivos WHERE vehiculo_id=@vid ORDER BY nombre`)
  return r.recordset
}

// Categorías ya usadas en cualquier requerimiento de la flota: alimentan el
// selector del formulario para que una categoría creada una vez quede
// disponible después en todos los vehículos.
export async function findCategorias(): Promise<string[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT categoria FROM (
      SELECT DISTINCT categoria FROM requerimientos_exclusivos
      WHERE categoria IS NOT NULL AND LTRIM(RTRIM(categoria)) <> ''
      UNION
      SELECT DISTINCT categoria FROM plantilla_requerimientos_modelo
      WHERE categoria IS NOT NULL AND LTRIM(RTRIM(categoria)) <> ''
    ) AS c
    ORDER BY categoria
  `)
  return r.recordset.map((row: { categoria: string }) => row.categoria)
}

export async function findById(id: number): Promise<RequerimientoExclusivo | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM requerimientos_exclusivos WHERE id=@id`)
  return r.recordset[0] ?? null
}

export async function create(data: RequerimientoCreate): Promise<RequerimientoExclusivo> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid',           sql.Int,              data.vehiculo_id)
    .input('nombre',        sql.NVarChar(120),    data.nombre)
    .input('descripcion',   sql.NVarChar(sql.MAX), data.descripcion      ?? null)
    .input('categoria',     sql.NVarChar(80),     data.categoria         ?? null)
    .input('triggerMode',   sql.NVarChar(20),     data.trigger_mode)
    .input('tipo',          sql.NVarChar(20),     data.tipo              ?? 'recurrente')
    .input('intervaloKm',   sql.Int,              data.intervalo_km      ?? null)
    .input('intervaloMes',  sql.Int,              data.intervalo_meses   ?? null)
    .input('intervaloDia',  sql.Int,              data.intervalo_dias    ?? null)
    .input('status',        sql.NVarChar(20),     data.status            ?? 'activo')
    .input('origenId',      sql.Int,              data.plantilla_origen_id ?? null)
    .input('fechaInicio',   sql.Date,             data.fecha_inicio        ?? null)
    .input('kmInicio',      sql.Int,              data.km_inicio           ?? null)
    .input('fechaReporte',  sql.Date,             data.fecha_reporte       ?? null)
    .query(`
      INSERT INTO requerimientos_exclusivos
        (vehiculo_id, nombre, descripcion, categoria, trigger_mode, tipo,
         intervalo_km, intervalo_meses, intervalo_dias, status, plantilla_origen_id, fecha_inicio, km_inicio, fecha_reporte)
      OUTPUT INSERTED.*
      VALUES (@vid, @nombre, @descripcion, @categoria, @triggerMode, @tipo,
              @intervaloKm, @intervaloMes, @intervaloDia, @status, @origenId, @fechaInicio, @kmInicio, @fechaReporte)
    `)
  return r.recordset[0]
}

export async function update(id: number, data: RequerimientoUpdate): Promise<RequerimientoExclusivo | null> {
  const pool = await getPool()
  const sets: string[] = ['updated_at=SYSDATETIME()']
  const req = pool.request().input('id', sql.Int, id)

  if (data.nombre       !== undefined) { req.input('nombre',      sql.NVarChar(120),     data.nombre);          sets.push('nombre=@nombre')              }
  if ('descripcion' in data)           { req.input('descripcion', sql.NVarChar(sql.MAX), data.descripcion ?? null); sets.push('descripcion=@descripcion') }
  if ('categoria'   in data)           { req.input('categoria',   sql.NVarChar(80),      data.categoria   ?? null); sets.push('categoria=@categoria')     }
  if (data.trigger_mode !== undefined) { req.input('triggerMode', sql.NVarChar(20),      data.trigger_mode);     sets.push('trigger_mode=@triggerMode')   }
  if (data.tipo         !== undefined) { req.input('tipo',        sql.NVarChar(20),      data.tipo);             sets.push('tipo=@tipo')                  }
  if ('intervalo_km'   in data)        { req.input('intervaloKm', sql.Int,               data.intervalo_km    ?? null); sets.push('intervalo_km=@intervaloKm') }
  if ('intervalo_meses' in data)       { req.input('intervaloMes',sql.Int,               data.intervalo_meses ?? null); sets.push('intervalo_meses=@intervaloMes') }
  if ('intervalo_dias'  in data)       { req.input('intervaloDia',sql.Int,               data.intervalo_dias  ?? null); sets.push('intervalo_dias=@intervaloDia') }
  if (data.status        !== undefined) { req.input('status',      sql.NVarChar(20), data.status);             sets.push('status=@status')                   }
  if ('fecha_inicio' in data)           { req.input('fechaInicio', sql.Date,         data.fecha_inicio ?? null); sets.push('fecha_inicio=@fechaInicio')         }
  if ('km_inicio'    in data)           { req.input('kmInicio',    sql.Int,          data.km_inicio    ?? null); sets.push('km_inicio=@kmInicio')               }
  if ('fecha_reporte' in data)          { req.input('fechaReporte', sql.Date,        data.fecha_reporte ?? null); sets.push('fecha_reporte=@fechaReporte')       }

  const r = await req.query(
    `UPDATE requerimientos_exclusivos SET ${sets.join(',')} OUTPUT INSERTED.* WHERE id=@id`
  )
  return r.recordset[0] ?? null
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM requerimientos_exclusivos OUTPUT DELETED.id WHERE id=@id')
  return r.recordset.length > 0
}

// Recalcula el status de requerimientos únicos según la fecha del mantenimiento
// vinculado más reciente: 'completado' si esa fecha ya llegó (<=hoy), 'activo'
// si sigue programada a futuro. Sin `ids`, corre sobre todos los únicos con
// algún mantenimiento vinculado (para la sincronización global diaria). Con
// `ids`, se limita a esos requerimientos (para sincronizar tras un cambio puntual).
export async function syncUnicaStatuses(
  exec: sql.ConnectionPool | sql.Transaction, ids?: number[]
): Promise<void> {
  if (ids && ids.length === 0) return
  const filter = ids ? `AND re.id IN (${ids.join(',')})` : ''
  await exec.request().query(`
    UPDATE re
    SET re.status = CASE
                       WHEN latest.fecha <= CAST(GETDATE() AS DATE) THEN 'completado'
                       ELSE 'activo' END,
        re.updated_at = SYSDATETIME()
    FROM requerimientos_exclusivos re
    CROSS APPLY (
      SELECT TOP 1 m.fecha
      FROM mantenimiento_requerimientos mr
      JOIN mantenimiento m ON m.id = mr.mantenimiento_id
      WHERE mr.requerimiento_id = re.id
      ORDER BY m.fecha DESC
    ) latest
    WHERE re.tipo = 'unica' ${filter}
  `)
}
