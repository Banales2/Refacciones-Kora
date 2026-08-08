import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface Mantenimiento {
  id:               number
  vehiculo_id:      number
  fecha:            string | null
  tipo:             string | null
  tecnico_id:       number | null
  // Nombre resuelto del catálogo. Queda en null si el técnico se eliminó.
  tecnico:          string | null
  costo:            number
  km_actual:        number
  observaciones:    string | null
  // Preventivos e incidencias que este mantenimiento atendió, sin distinguir:
  // ambos son `pendientes`.
  pendiente_ids:    number[]
  piezas_total:     number
}

export interface MantenimientoCreate {
  vehiculo_id:        number
  fecha:              string
  tipo?:              string | null
  tecnico_id?:        number | null
  costo?:             number
  km_actual?:         number
  observaciones?:     string | null
  pendiente_ids?: number[]
}

export interface MantenimientoUpdate {
  fecha?:             string
  tipo?:              string | null
  tecnico_id?:        number | null
  costo?:             number
  km_actual?:         number
  observaciones?:     string | null
  pendiente_ids?: number[]
}

// El nombre del técnico sale del catálogo por join, no de la columna vieja: si
// se eliminó del catálogo, tecnico_id quedó en NULL y aquí se ve vacío.
const SELECT_MANT = `
  SELECT m.id, m.vehiculo_id, m.fecha, m.tipo, m.tecnico_id, t.nombre AS tecnico,
         m.costo, m.km_actual, m.observaciones
  FROM mantenimiento m
  LEFT JOIN tecnicos t ON t.id = m.tecnico_id`

async function attachPendienteIds(
  pool: sql.ConnectionPool,
  rows: Omit<Mantenimiento, 'pendiente_ids' | 'piezas_total'>[],
): Promise<Omit<Mantenimiento, 'piezas_total'>[]> {
  if (rows.length === 0) return []
  const req = pool.request()
  const params = rows.map((r, i) => {
    req.input(`m${i}`, sql.Int, r.id)
    return `@m${i}`
  })
  const lr = await req.query(
    `SELECT mantenimiento_id, pendiente_id FROM mantenimiento_pendientes WHERE mantenimiento_id IN (${params.join(',')})`
  )
  const map = new Map<number, number[]>()
  for (const { mantenimiento_id, pendiente_id } of lr.recordset) {
    if (!map.has(mantenimiento_id)) map.set(mantenimiento_id, [])
    map.get(mantenimiento_id)!.push(pendiente_id)
  }
  return rows.map(r => ({ ...r, pendiente_ids: map.get(r.id) ?? [] }))
}

// El puente guarda km y fecha del servicio, y `origen` copiado del padre (el FK
// compuesto obliga a que coincida). Por eso el INSERT sale de `pendientes` en
// vez de meter valores sueltos: así `origen` nunca puede desincronizarse.
async function linkPendientes(
  tx: sql.Transaction, mantenimientoId: number, ids: number[],
  fecha: string, kmActual: number | null,
): Promise<void> {
  for (const pid of ids) {
    await tx.request()
      .input('mid',   sql.Int,  mantenimientoId)
      .input('pid',   sql.Int,  pid)
      .input('fecha', sql.Date, fecha)
      .input('km',    sql.Int,  kmActual)
      .query(`
        INSERT INTO mantenimiento_pendientes (mantenimiento_id, pendiente_id, origen, fecha, km_actual)
        SELECT @mid, p.id, p.origen, @fecha, @km
        FROM pendientes p WHERE p.id = @pid
      `)
  }
}

async function attachPiezasTotal(
  pool: sql.ConnectionPool,
  rows: Omit<Mantenimiento, 'piezas_total'>[],
): Promise<Mantenimiento[]> {
  if (rows.length === 0) return []
  const req = pool.request()
  const params = rows.map((r, i) => {
    req.input(`m${i}`, sql.Int, r.id)
    return `@m${i}`
  })
  const pr = await req.query(`
    SELECT mantenimiento_id, SUM(cantidad * costo_unitario) AS piezas_total
    FROM detalle_mtto_pieza
    WHERE mantenimiento_id IN (${params.join(',')})
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
    .query(`${SELECT_MANT} WHERE m.vehiculo_id=@vid ORDER BY m.fecha DESC`)
  const withReqs = await attachPendienteIds(pool, r.recordset)
  return attachPiezasTotal(pool, withReqs)
}

export async function findById(id: number): Promise<Mantenimiento | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_MANT} WHERE m.id=@id`)
  if (!r.recordset[0]) return null
  const [withReqs] = await attachPendienteIds(pool, [r.recordset[0]])
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
      .input('tecnicoId',     sql.Int,               data.tecnico_id    ?? null)
      .input('costo',         sql.Decimal(18, 2),    data.costo         ?? 0)
      .input('kmActual',      sql.Int,               data.km_actual     ?? 0)
      .input('observaciones', sql.NVarChar(sql.MAX), data.observaciones ?? null)
      .query(`
        INSERT INTO mantenimiento (vehiculo_id, fecha, tipo, tecnico_id, costo, km_actual, observaciones)
        OUTPUT INSERTED.*
        VALUES (@vid, @fecha, @tipo, @tecnicoId, @costo, @kmActual, @observaciones)
      `)
    const mant = r.recordset[0]
    await linkPendientes(tx, mant.id, data.pendiente_ids ?? [], data.fecha, data.km_actual ?? null)
    await tx.commit()
    // Se relee para traer el nombre del técnico resuelto por el join.
    return (await findById(mant.id))
      ?? { ...mant, tecnico: null, pendiente_ids: data.pendiente_ids ?? [], piezas_total: 0 }
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
    if ('tecnico_id'   in data)           { req.input('tecnicoId',     sql.Int,               data.tecnico_id    ?? null); sets.push('tecnico_id=@tecnicoId')        }
    if (data.costo         !== undefined) { req.input('costo',         sql.Decimal(18, 2),    data.costo);               sets.push('costo=@costo')                 }
    if (data.km_actual     !== undefined) { req.input('kmActual',      sql.Int,               data.km_actual);           sets.push('km_actual=@kmActual')           }
    if ('observaciones' in data)          { req.input('observaciones', sql.NVarChar(sql.MAX), data.observaciones ?? null); sets.push('observaciones=@observaciones') }
    if (sets.length) {
      await req.query(`UPDATE mantenimiento SET ${sets.join(',')} OUTPUT INSERTED.* WHERE id=@id`)
    }
    if ('pendiente_ids' in data) {
      // Diferencial en vez de borrar todo y reinsertar: así no se tocan filas
      // que no cambian. El snapshot no depende de esto — se resincroniza abajo.
      const prev: number[] = (await tx.request().input('id', sql.Int, id)
        .query('SELECT pendiente_id FROM mantenimiento_pendientes WHERE mantenimiento_id=@id'))
        .recordset.map((r: { pendiente_id: number }) => r.pendiente_id)

      const next     = data.pendiente_ids ?? []
      const quitados = prev.filter(pid => !next.includes(pid))
      const nuevos   = next.filter(pid => !prev.includes(pid))

      for (const pid of quitados) {
        await tx.request()
          .input('mid', sql.Int, id)
          .input('pid', sql.Int, pid)
          .query('DELETE FROM mantenimiento_pendientes WHERE mantenimiento_id=@mid AND pendiente_id=@pid')
      }

      if (nuevos.length) {
        const actual = (await tx.request().input('id', sql.Int, id)
          .query('SELECT fecha, km_actual FROM mantenimiento WHERE id=@id')).recordset[0]
        const fecha = typeof actual.fecha === 'string'
          ? actual.fecha.split('T')[0]
          : new Date(actual.fecha).toISOString().split('T')[0]
        await linkPendientes(tx, id, nuevos, fecha, actual.km_actual ?? null)
      }
    }

    // Corregir la fecha o el kilometraje de un mantenimiento es corregir el
    // mismo evento, así que el snapshot de lo que atendió se corrige con él.
    // Sin esto, arreglar un typo dejaría los vencimientos calculados sobre el
    // dato viejo. Sale del propio mantenimiento para no depender de si el valor
    // vino en este update o ya estaba.
    if ('fecha' in data || 'km_actual' in data) {
      await tx.request().input('id', sql.Int, id).query(`
        UPDATE mp
        SET mp.fecha = m.fecha, mp.km_actual = m.km_actual
        FROM mantenimiento_pendientes mp
        JOIN mantenimiento m ON m.id = mp.mantenimiento_id
        WHERE mp.mantenimiento_id = @id
      `)
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
      .query('DELETE FROM mantenimiento_pendientes WHERE mantenimiento_id=@id')

    const r = await tx.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM mantenimiento OUTPUT DELETED.id WHERE id=@id')

    await tx.commit()
    return r.recordset.length > 0
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
