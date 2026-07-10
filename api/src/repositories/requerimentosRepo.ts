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
  status?:          StatusReq
  fecha_inicio?:    string | null
  km_inicio?:       number | null
  fecha_reporte?:   string | null
}

const COLS = `id, nombre, descripcion, categoria, intervalo_km, intervalo_meses,
  trigger_mode, tipo, status, created_at, updated_at, vehiculo_id, plantilla_origen_id,
  fecha_inicio, km_inicio, fecha_reporte`

export async function findByVehiculo(vehiculoId: number): Promise<RequerimientoExclusivo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`SELECT ${COLS} FROM requerimientos_exclusivos WHERE vehiculo_id=@vid ORDER BY nombre`)
  return r.recordset
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
    .input('status',        sql.NVarChar(20),     data.status            ?? 'activo')
    .input('origenId',      sql.Int,              data.plantilla_origen_id ?? null)
    .input('fechaInicio',   sql.Date,             data.fecha_inicio        ?? null)
    .input('kmInicio',      sql.Int,              data.km_inicio           ?? null)
    .input('fechaReporte',  sql.Date,             data.fecha_reporte       ?? null)
    .query(`
      INSERT INTO requerimientos_exclusivos
        (vehiculo_id, nombre, descripcion, categoria, trigger_mode, tipo,
         intervalo_km, intervalo_meses, status, plantilla_origen_id, fecha_inicio, km_inicio, fecha_reporte)
      OUTPUT INSERTED.*
      VALUES (@vid, @nombre, @descripcion, @categoria, @triggerMode, @tipo,
              @intervaloKm, @intervaloMes, @status, @origenId, @fechaInicio, @kmInicio, @fechaReporte)
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
