import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface Mantenimiento {
  id:            number
  vehiculo_id:   number
  fecha:         string | null
  tipo:          string | null
  tecnico:       string | null
  costo:         number
  km_actual:     number
  observaciones: string | null
}

export interface MantenimientoCreate {
  vehiculo_id:   number
  fecha:         string
  tipo?:         string | null
  tecnico?:      string | null
  costo?:        number
  km_actual?:    number
  observaciones?: string | null
}

export interface MantenimientoUpdate {
  fecha?:         string
  tipo?:          string | null
  tecnico?:       string | null
  costo?:         number
  km_actual?:     number
  observaciones?: string | null
}

const COLS = 'id, vehiculo_id, fecha, tipo, tecnico, costo, km_actual, observaciones'

export async function findByVehiculo(vehiculoId: number): Promise<Mantenimiento[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`SELECT ${COLS} FROM mantenimiento WHERE vehiculo_id=@vid ORDER BY fecha DESC`)
  return r.recordset
}

export async function findById(id: number): Promise<Mantenimiento | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM mantenimiento WHERE id=@id`)
  return r.recordset[0] ?? null
}

export async function create(data: MantenimientoCreate): Promise<Mantenimiento> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid',           sql.Int,              data.vehiculo_id)
    .input('fecha',         sql.Date,             data.fecha)
    .input('tipo',          sql.NVarChar(80),     data.tipo          ?? null)
    .input('tecnico',       sql.NVarChar(120),    data.tecnico       ?? null)
    .input('costo',         sql.Int,              data.costo         ?? 0)
    .input('kmActual',      sql.Int,              data.km_actual     ?? 0)
    .input('observaciones', sql.NVarChar(sql.MAX), data.observaciones ?? null)
    .query(`
      INSERT INTO mantenimiento (vehiculo_id, fecha, tipo, tecnico, costo, km_actual, observaciones)
      OUTPUT INSERTED.*
      VALUES (@vid, @fecha, @tipo, @tecnico, @costo, @kmActual, @observaciones)
    `)
  return r.recordset[0]
}

export async function update(id: number, data: MantenimientoUpdate): Promise<Mantenimiento | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)

  if (data.fecha         !== undefined) { req.input('fecha',         sql.Date,              data.fecha);               sets.push('fecha=@fecha')                 }
  if ('tipo'         in data)           { req.input('tipo',          sql.NVarChar(80),      data.tipo          ?? null); sets.push('tipo=@tipo')                   }
  if ('tecnico'      in data)           { req.input('tecnico',       sql.NVarChar(120),     data.tecnico       ?? null); sets.push('tecnico=@tecnico')             }
  if (data.costo         !== undefined) { req.input('costo',         sql.Int,               data.costo);               sets.push('costo=@costo')                 }
  if (data.km_actual     !== undefined) { req.input('kmActual',      sql.Int,               data.km_actual);           sets.push('km_actual=@kmActual')           }
  if ('observaciones' in data)          { req.input('observaciones', sql.NVarChar(sql.MAX), data.observaciones ?? null); sets.push('observaciones=@observaciones') }

  if (!sets.length) return findById(id)

  const r = await req.query(`UPDATE mantenimiento SET ${sets.join(',')} OUTPUT INSERTED.* WHERE id=@id`)
  return r.recordset[0] ?? null
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM mantenimiento OUTPUT DELETED.id WHERE id=@id')
  return r.recordset.length > 0
}
