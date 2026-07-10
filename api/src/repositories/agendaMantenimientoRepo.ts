import * as sql from 'mssql'
import { getPool } from '../shared/db'

export type AgendaStatus = 'pendiente' | 'completada' | 'cancelada'

export interface AgendaMantenimiento {
  id:               number
  vehiculo_id:      number
  fecha_inicio:     string
  fecha_fin:        string
  tipo:             string | null
  tecnico:          string | null
  observaciones:    string | null
  status:           AgendaStatus
  mantenimiento_id: number | null
  requerimiento_ids: number[]
  created_at:       string
  updated_at:       string
}

export interface AgendaConVehiculo extends AgendaMantenimiento {
  vehiculo_nombre: string
  vehiculo_tipo:   string
}

export interface AgendaMantenimientoCreate {
  vehiculo_id:        number
  fecha_inicio:       string
  fecha_fin:          string
  tipo?:              string | null
  tecnico?:           string | null
  observaciones?:     string | null
  requerimiento_ids?: number[]
}

export interface AgendaMantenimientoUpdate {
  fecha_inicio?:      string
  fecha_fin?:         string
  tipo?:              string | null
  tecnico?:           string | null
  observaciones?:     string | null
  status?:            AgendaStatus
  requerimiento_ids?: number[]
}

const COLS = `id, vehiculo_id, fecha_inicio, fecha_fin, tipo, tecnico, observaciones,
  status, mantenimiento_id, created_at, updated_at`

async function attachReqIds<T extends { id: number }>(
  pool: sql.ConnectionPool, rows: T[]
): Promise<(T & { requerimiento_ids: number[] })[]> {
  if (rows.length === 0) return []
  const ids = rows.map(r => r.id).join(',')
  const lr = await pool.request().query(
    `SELECT agenda_id, requerimiento_id FROM agenda_requerimientos WHERE agenda_id IN (${ids})`
  )
  const map = new Map<number, number[]>()
  for (const { agenda_id, requerimiento_id } of lr.recordset) {
    if (!map.has(agenda_id)) map.set(agenda_id, [])
    map.get(agenda_id)!.push(requerimiento_id)
  }
  return rows.map(r => ({ ...r, requerimiento_ids: map.get(r.id) ?? [] }))
}

export async function findByVehiculo(vehiculoId: number): Promise<AgendaMantenimiento[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`SELECT ${COLS} FROM agendas_mantenimiento WHERE vehiculo_id=@vid ORDER BY fecha_inicio DESC`)
  return attachReqIds(pool, r.recordset)
}

export async function findById(id: number): Promise<AgendaMantenimiento | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM agendas_mantenimiento WHERE id=@id`)
  if (!r.recordset[0]) return null
  const [row] = await attachReqIds(pool, [r.recordset[0]])
  return row
}

export async function findAllConVehiculo(): Promise<AgendaConVehiculo[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT a.id, a.vehiculo_id, a.fecha_inicio, a.fecha_fin, a.tipo, a.tecnico, a.observaciones,
           a.status, a.mantenimiento_id, a.created_at, a.updated_at,
           CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo_nombre,
           v.tipo AS vehiculo_tipo
    FROM agendas_mantenimiento a
    JOIN vehiculos v  ON v.id = a.vehiculo_id
    JOIN modelos mo   ON mo.id = v.modelo_id
    ORDER BY a.fecha_inicio DESC
  `)
  return attachReqIds(pool, r.recordset)
}

export async function create(data: AgendaMantenimientoCreate): Promise<AgendaMantenimiento> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const r = await tx.request()
      .input('vid',           sql.Int,               data.vehiculo_id)
      .input('fechaInicio',   sql.Date,              data.fecha_inicio)
      .input('fechaFin',      sql.Date,              data.fecha_fin)
      .input('tipo',          sql.NVarChar(80),      data.tipo ?? null)
      .input('tecnico',       sql.NVarChar(120),     data.tecnico ?? null)
      .input('observaciones', sql.NVarChar(sql.MAX), data.observaciones ?? null)
      .query(`
        INSERT INTO agendas_mantenimiento (vehiculo_id, fecha_inicio, fecha_fin, tipo, tecnico, observaciones)
        OUTPUT INSERTED.*
        VALUES (@vid, @fechaInicio, @fechaFin, @tipo, @tecnico, @observaciones)
      `)
    const agenda = r.recordset[0]
    if (data.requerimiento_ids?.length) {
      const values = data.requerimiento_ids.map((_, i) => `(@aid, @rid${i})`).join(',')
      const linkReq = tx.request().input('aid', sql.Int, agenda.id)
      data.requerimiento_ids.forEach((rid, i) => linkReq.input(`rid${i}`, sql.Int, rid))
      await linkReq.query(`INSERT INTO agenda_requerimientos (agenda_id, requerimiento_id) VALUES ${values}`)
    }
    await tx.commit()
    return { ...agenda, requerimiento_ids: data.requerimiento_ids ?? [] }
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

export async function update(id: number, data: AgendaMantenimientoUpdate): Promise<AgendaMantenimiento | null> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const sets: string[] = ['updated_at=SYSDATETIME()']
    const req = tx.request().input('id', sql.Int, id)

    if (data.fecha_inicio !== undefined) { req.input('fechaInicio', sql.Date, data.fecha_inicio); sets.push('fecha_inicio=@fechaInicio') }
    if (data.fecha_fin    !== undefined) { req.input('fechaFin',    sql.Date, data.fecha_fin);    sets.push('fecha_fin=@fechaFin')       }
    if ('tipo' in data)                  { req.input('tipo',        sql.NVarChar(80),  data.tipo ?? null);          sets.push('tipo=@tipo')                 }
    if ('tecnico' in data)               { req.input('tecnico',     sql.NVarChar(120), data.tecnico ?? null);       sets.push('tecnico=@tecnico')           }
    if ('observaciones' in data)         { req.input('observaciones', sql.NVarChar(sql.MAX), data.observaciones ?? null); sets.push('observaciones=@observaciones') }
    if (data.status        !== undefined) { req.input('status',     sql.NVarChar(20),  data.status);                sets.push('status=@status')             }

    await req.query(`UPDATE agendas_mantenimiento SET ${sets.join(',')} WHERE id=@id`)

    if (data.requerimiento_ids !== undefined) {
      await tx.request().input('id', sql.Int, id)
        .query('DELETE FROM agenda_requerimientos WHERE agenda_id=@id')
      if (data.requerimiento_ids.length) {
        const values = data.requerimiento_ids.map((_, i) => `(@aid, @rid${i})`).join(',')
        const linkReq = tx.request().input('aid', sql.Int, id)
        data.requerimiento_ids.forEach((rid, i) => linkReq.input(`rid${i}`, sql.Int, rid))
        await linkReq.query(`INSERT INTO agenda_requerimientos (agenda_id, requerimiento_id) VALUES ${values}`)
      }
    }

    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
  return findById(id)
}

export async function marcarCompletada(id: number, mantenimientoId: number): Promise<void> {
  const pool = await getPool()
  await pool.request()
    .input('id', sql.Int, id)
    .input('mid', sql.Int, mantenimientoId)
    .query(`
      UPDATE agendas_mantenimiento
      SET status='completada', mantenimiento_id=@mid, updated_at=SYSDATETIME()
      WHERE id=@id
    `)
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM agendas_mantenimiento OUTPUT DELETED.id WHERE id=@id')
  return r.recordset.length > 0
}
