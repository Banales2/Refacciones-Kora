import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { syncUnicaStatuses } from './requerimentosRepo'

export interface Mantenimiento {
  id:               number
  vehiculo_id:      number
  fecha:            string | null
  tipo:             string | null
  tecnico:          string | null
  costo:            number
  km_actual:        number
  observaciones:    string | null
  requerimiento_ids: number[]
  piezas_total:     number
}

export interface MantenimientoCreate {
  vehiculo_id:        number
  fecha:              string
  tipo?:              string | null
  tecnico?:           string | null
  costo?:             number
  km_actual?:         number
  observaciones?:     string | null
  requerimiento_ids?: number[]
}

export interface MantenimientoUpdate {
  fecha?:             string
  tipo?:              string | null
  tecnico?:           string | null
  costo?:             number
  km_actual?:         number
  observaciones?:     string | null
  requerimiento_ids?: number[]
}

const COLS = 'id, vehiculo_id, fecha, tipo, tecnico, costo, km_actual, observaciones'

async function attachReqIds(
  pool: sql.ConnectionPool,
  rows: Omit<Mantenimiento, 'requerimiento_ids' | 'piezas_total'>[],
): Promise<Omit<Mantenimiento, 'piezas_total'>[]> {
  if (rows.length === 0) return []
  const ids = rows.map(r => r.id).join(',')
  const lr = await pool.request().query(
    `SELECT mantenimiento_id, requerimiento_id FROM mantenimiento_requerimientos WHERE mantenimiento_id IN (${ids})`
  )
  const map = new Map<number, number[]>()
  for (const { mantenimiento_id, requerimiento_id } of lr.recordset) {
    if (!map.has(mantenimiento_id)) map.set(mantenimiento_id, [])
    map.get(mantenimiento_id)!.push(requerimiento_id)
  }
  return rows.map(r => ({ ...r, requerimiento_ids: map.get(r.id) ?? [] }))
}

async function attachPiezasTotal(
  pool: sql.ConnectionPool,
  rows: Omit<Mantenimiento, 'piezas_total'>[],
): Promise<Mantenimiento[]> {
  if (rows.length === 0) return []
  const ids = rows.map(r => r.id).join(',')
  const pr = await pool.request().query(`
    SELECT mantenimiento_id, SUM(cantidad * costo_unitario) AS piezas_total
    FROM detalle_mtto_pieza
    WHERE mantenimiento_id IN (${ids})
    GROUP BY mantenimiento_id
  `)
  const map = new Map<number, number>()
  for (const { mantenimiento_id, piezas_total } of pr.recordset) {
    map.set(mantenimiento_id, piezas_total)
  }
  return rows.map(r => ({ ...r, piezas_total: map.get(r.id) ?? 0 }))
}

export async function findByVehiculo(vehiculoId: number): Promise<Mantenimiento[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('vid', sql.Int, vehiculoId)
    .query(`SELECT ${COLS} FROM mantenimiento WHERE vehiculo_id=@vid ORDER BY fecha DESC`)
  const withReqs = await attachReqIds(pool, r.recordset)
  return attachPiezasTotal(pool, withReqs)
}

export async function findById(id: number): Promise<Mantenimiento | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM mantenimiento WHERE id=@id`)
  if (!r.recordset[0]) return null
  const [withReqs] = await attachReqIds(pool, [r.recordset[0]])
  const [row] = await attachPiezasTotal(pool, [withReqs])
  return row
}

export async function create(data: MantenimientoCreate): Promise<Mantenimiento> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const r = await tx.request()
      .input('vid',           sql.Int,               data.vehiculo_id)
      .input('fecha',         sql.Date,              data.fecha)
      .input('tipo',          sql.NVarChar(80),      data.tipo          ?? null)
      .input('tecnico',       sql.NVarChar(120),     data.tecnico       ?? null)
      .input('costo',         sql.Decimal(18, 2),    data.costo         ?? 0)
      .input('kmActual',      sql.Int,               data.km_actual     ?? 0)
      .input('observaciones', sql.NVarChar(sql.MAX), data.observaciones ?? null)
      .query(`
        INSERT INTO mantenimiento (vehiculo_id, fecha, tipo, tecnico, costo, km_actual, observaciones)
        OUTPUT INSERTED.*
        VALUES (@vid, @fecha, @tipo, @tecnico, @costo, @kmActual, @observaciones)
      `)
    const mant = r.recordset[0]
    for (const rid of data.requerimiento_ids ?? []) {
      await tx.request()
        .input('mid', sql.Int, mant.id)
        .input('rid', sql.Int, rid)
        .query('INSERT INTO mantenimiento_requerimientos (mantenimiento_id, requerimiento_id) VALUES (@mid, @rid)')
    }
    await syncUnicaStatuses(tx, data.requerimiento_ids ?? [])
    await tx.commit()
    return { ...mant, requerimiento_ids: data.requerimiento_ids ?? [], piezas_total: 0 }
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

export async function update(id: number, data: MantenimientoUpdate): Promise<Mantenimiento | null> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const sets: string[] = []
    const req = tx.request().input('id', sql.Int, id)
    if (data.fecha         !== undefined) { req.input('fecha',         sql.Date,              data.fecha);               sets.push('fecha=@fecha')                 }
    if ('tipo'         in data)           { req.input('tipo',          sql.NVarChar(80),      data.tipo          ?? null); sets.push('tipo=@tipo')                   }
    if ('tecnico'      in data)           { req.input('tecnico',       sql.NVarChar(120),     data.tecnico       ?? null); sets.push('tecnico=@tecnico')             }
    if (data.costo         !== undefined) { req.input('costo',         sql.Decimal(18, 2),    data.costo);               sets.push('costo=@costo')                 }
    if (data.km_actual     !== undefined) { req.input('kmActual',      sql.Int,               data.km_actual);           sets.push('km_actual=@kmActual')           }
    if ('observaciones' in data)          { req.input('observaciones', sql.NVarChar(sql.MAX), data.observaciones ?? null); sets.push('observaciones=@observaciones') }
    if (sets.length) {
      await req.query(`UPDATE mantenimiento SET ${sets.join(',')} OUTPUT INSERTED.* WHERE id=@id`)
    }
    if ('requerimiento_ids' in data) {
      const prevIds = (await tx.request().input('id', sql.Int, id)
        .query('SELECT requerimiento_id FROM mantenimiento_requerimientos WHERE mantenimiento_id=@id'))
        .recordset.map((r: { requerimiento_id: number }) => r.requerimiento_id)
      const nextIds = data.requerimiento_ids ?? []
      const removedIds = prevIds.filter(rid => !nextIds.includes(rid))

      await tx.request().input('id', sql.Int, id)
        .query('DELETE FROM mantenimiento_requerimientos WHERE mantenimiento_id=@id')
      for (const rid of nextIds) {
        await tx.request()
          .input('mid', sql.Int, id)
          .input('rid', sql.Int, rid)
          .query('INSERT INTO mantenimiento_requerimientos (mantenimiento_id, requerimiento_id) VALUES (@mid, @rid)')
      }
      for (const rid of removedIds) {
        await tx.request()
          .input('rid', sql.Int, rid)
          .query("UPDATE requerimientos_exclusivos SET status='activo', updated_at=SYSDATETIME() WHERE id=@rid AND tipo='unica' AND status='completado'")
      }
      await syncUnicaStatuses(tx, nextIds)
      // Por si un requerimiento desvinculado de este mantenimiento sigue enlazado a otro
      await syncUnicaStatuses(tx, removedIds)
    } else if (data.fecha !== undefined) {
      // La fecha del mantenimiento cambió pero sus enlaces no; reevaluar con los enlaces actuales
      const curIds = (await tx.request().input('id', sql.Int, id)
        .query('SELECT requerimiento_id FROM mantenimiento_requerimientos WHERE mantenimiento_id=@id'))
        .recordset.map((r: { requerimiento_id: number }) => r.requerimiento_id)
      await syncUnicaStatuses(tx, curIds)
    }
    await tx.commit()
  } catch (err) {
    await tx.rollback()
    throw err
  }
  return findById(id)
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const linkedIds = (await tx.request().input('id', sql.Int, id)
      .query('SELECT requerimiento_id FROM mantenimiento_requerimientos WHERE mantenimiento_id=@id'))
      .recordset.map((r: { requerimiento_id: number }) => r.requerimiento_id)

    // Devolver al inventario las piezas consumidas y liberar la FK de detalle_mtto_pieza
    const detalles = (await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM detalle_mtto_pieza OUTPUT DELETED.lote_id, DELETED.cantidad WHERE mantenimiento_id=@id'))
      .recordset as { lote_id: number; cantidad: number }[]
    for (const d of detalles) {
      await tx.request()
        .input('lid',  sql.Int, d.lote_id)
        .input('cant', sql.Int, d.cantidad)
        .query('UPDATE lotes_pieza SET cantidad_disponible = cantidad_disponible + @cant WHERE id=@lid')
    }

    await tx.request().input('id', sql.Int, id)
      .query('DELETE FROM mantenimiento_requerimientos WHERE mantenimiento_id=@id')

    const r = await tx.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM mantenimiento OUTPUT DELETED.id WHERE id=@id')

    for (const rid of linkedIds) {
      await tx.request()
        .input('rid', sql.Int, rid)
        .query("UPDATE requerimientos_exclusivos SET status='activo', updated_at=SYSDATETIME() WHERE id=@rid AND tipo='unica' AND status='completado'")
    }
    // Por si el requerimiento sigue enlazado a otro mantenimiento
    await syncUnicaStatuses(tx, linkedIds)

    await tx.commit()
    return r.recordset.length > 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
