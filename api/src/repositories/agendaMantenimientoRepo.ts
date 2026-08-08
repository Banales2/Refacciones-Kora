import * as sql from 'mssql'
import { getPool } from '../shared/db'

export type AgendaStatus = 'pendiente' | 'completada' | 'cancelada'

export interface AgendaMantenimiento {
  id:               number
  vehiculo_id:      number
  fecha_inicio:     string
  fecha_fin:        string
  tipo:             string | null
  tecnico_id:       number | null
  // Nombre resuelto del catálogo. Queda en null si el técnico se eliminó.
  tecnico:          string | null
  observaciones:    string | null
  status:           AgendaStatus
  mantenimiento_id: number | null
  // Preventivos e incidencias que esta agenda va a atender.
  pendiente_ids:    number[]
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
  tecnico_id?:        number | null
  observaciones?:     string | null
  pendiente_ids?: number[]
}

export interface AgendaMantenimientoUpdate {
  fecha_inicio?:      string
  fecha_fin?:         string
  tipo?:              string | null
  tecnico_id?:        number | null
  observaciones?:     string | null
  status?:            AgendaStatus
  pendiente_ids?: number[]
}

// El nombre del técnico sale del catálogo por join, no de la columna vieja: si
// se eliminó del catálogo, tecnico_id quedó en NULL y aquí se ve vacío.
const SELECT_AGENDA = `
  SELECT a.id, a.vehiculo_id, a.fecha_inicio, a.fecha_fin, a.tipo,
         a.tecnico_id, t.nombre AS tecnico, a.observaciones,
         a.status, a.mantenimiento_id, a.created_at, a.updated_at
  FROM agendas_mantenimiento a
  LEFT JOIN tecnicos t ON t.id = a.tecnico_id`

async function attachPendienteIds<T extends { id: number }>(
  pool: sql.ConnectionPool, rows: T[]
): Promise<(T & { pendiente_ids: number[] })[]> {
  if (rows.length === 0) return []
  const req = pool.request()
  const params = rows.map((r, i) => {
    req.input(`a${i}`, sql.Int, r.id)
    return `@a${i}`
  })
  const lr = await req.query(
    `SELECT agenda_id, pendiente_id FROM agenda_pendientes WHERE agenda_id IN (${params.join(',')})`
  )
  const map = new Map<number, number[]>()
  for (const { agenda_id, pendiente_id } of lr.recordset) {
    if (!map.has(agenda_id)) map.set(agenda_id, [])
    map.get(agenda_id)!.push(pendiente_id)
  }
  return rows.map(r => ({ ...r, pendiente_ids: map.get(r.id) ?? [] }))
}

export async function findByVehiculo(vehiculoId: number): Promise<AgendaMantenimiento[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`${SELECT_AGENDA} WHERE a.vehiculo_id=@vid ORDER BY a.fecha_inicio DESC`)
  return attachPendienteIds(pool, r.recordset)
}

export async function findById(id: number): Promise<AgendaMantenimiento | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_AGENDA} WHERE a.id=@id`)
  if (!r.recordset[0]) return null
  const [row] = await attachPendienteIds(pool, [r.recordset[0]])
  return row
}

export async function findAllConVehiculo(): Promise<AgendaConVehiculo[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT a.id, a.vehiculo_id, a.fecha_inicio, a.fecha_fin, a.tipo,
           a.tecnico_id, t.nombre AS tecnico, a.observaciones,
           a.status, a.mantenimiento_id, a.created_at, a.updated_at,
           CONCAT(mo.marca, ' ', mo.nombre, ' — ', v.numero_serie) AS vehiculo_nombre,
           v.tipo AS vehiculo_tipo
    FROM agendas_mantenimiento a
    LEFT JOIN tecnicos t ON t.id = a.tecnico_id
    JOIN vehiculos v  ON v.id = a.vehiculo_id
    JOIN modelos mo   ON mo.id = v.modelo_id
    ORDER BY a.fecha_inicio DESC
  `)
  return attachPendienteIds(pool, r.recordset)
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
      .input('tecnicoId',     sql.Int,               data.tecnico_id ?? null)
      .input('observaciones', sql.NVarChar(sql.MAX), data.observaciones ?? null)
      .query(`
        INSERT INTO agendas_mantenimiento (vehiculo_id, fecha_inicio, fecha_fin, tipo, tecnico_id, observaciones)
        OUTPUT INSERTED.*
        VALUES (@vid, @fechaInicio, @fechaFin, @tipo, @tecnicoId, @observaciones)
      `)
    const agenda = r.recordset[0]
    if (data.pendiente_ids?.length) {
      const values = data.pendiente_ids.map((_, i) => `(@aid, @pid${i})`).join(',')
      const linkReq = tx.request().input('aid', sql.Int, agenda.id)
      data.pendiente_ids.forEach((pid, i) => linkReq.input(`pid${i}`, sql.Int, pid))
      await linkReq.query(`INSERT INTO agenda_pendientes (agenda_id, pendiente_id) VALUES ${values}`)
    }
    await tx.commit()
    // Se relee para traer el nombre del técnico resuelto por el join.
    return (await findById(agenda.id))
      ?? { ...agenda, tecnico: null, pendiente_ids: data.pendiente_ids ?? [] }
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
    if ('tecnico_id' in data)            { req.input('tecnicoId',   sql.Int,           data.tecnico_id ?? null);    sets.push('tecnico_id=@tecnicoId')      }
    if ('observaciones' in data)         { req.input('observaciones', sql.NVarChar(sql.MAX), data.observaciones ?? null); sets.push('observaciones=@observaciones') }
    if (data.status        !== undefined) { req.input('status',     sql.NVarChar(20),  data.status);                sets.push('status=@status')             }

    await req.query(`UPDATE agendas_mantenimiento SET ${sets.join(',')} WHERE id=@id`)

    if (data.pendiente_ids !== undefined) {
      // La agenda no guarda snapshot (solo dice qué se piensa atender), así que
      // aquí sí se puede rehacer la lista completa sin perder información.
      await tx.request().input('id', sql.Int, id)
        .query('DELETE FROM agenda_pendientes WHERE agenda_id=@id')
      if (data.pendiente_ids.length) {
        const values = data.pendiente_ids.map((_, i) => `(@aid, @pid${i})`).join(',')
        const linkReq = tx.request().input('aid', sql.Int, id)
        data.pendiente_ids.forEach((pid, i) => linkReq.input(`pid${i}`, sql.Int, pid))
        await linkReq.query(`INSERT INTO agenda_pendientes (agenda_id, pendiente_id) VALUES ${values}`)
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
  const tx = pool.transaction()
  await tx.begin()
  try {
    // El vínculo con los pendientes es NO ACTION: hay que soltarlo antes o el FK
    // aborta el DELETE. Se borra el vínculo, no el pendiente en sí.
    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM agenda_pendientes WHERE agenda_id=@id')
    const r = await tx.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM agendas_mantenimiento OUTPUT DELETED.id WHERE id=@id')
    await tx.commit()
    return r.recordset.length > 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
