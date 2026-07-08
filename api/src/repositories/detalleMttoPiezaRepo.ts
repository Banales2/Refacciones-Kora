import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { DetalleMttoPiezaCreate, DetalleMttoPiezaUpdate } from '../schemas/detalleMttoPiezaSchema'

export interface DetalleMttoPieza {
  id:               number
  mantenimiento_id: number
  lote_id:          number
  cantidad:         number
  costo_unitario:   number
  pieza_id:         number
  numero_serie:     string
  descripcion:      string
  lote_disponible:  number
}

export interface LoteDisponible {
  id:                  number
  pieza_id:            number
  numero_serie:        string
  descripcion:         string
  costo_unitario:      number
  cantidad_disponible: number
  fecha_compra:        string
}

const SELECT_DETALLE = `
  SELECT d.id, d.mantenimiento_id, d.lote_id, d.cantidad, d.costo_unitario,
         p.id AS pieza_id, p.numero_serie, p.descripcion,
         l.cantidad_disponible AS lote_disponible
  FROM detalle_mtto_pieza d
  JOIN lotes_pieza l ON l.id = d.lote_id
  JOIN piezas p ON p.id = l.pieza_id
`

export async function findByMantenimientoId(mantenimientoId: number): Promise<DetalleMttoPieza[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('mid', sql.Int, mantenimientoId)
    .query(`${SELECT_DETALLE} WHERE d.mantenimiento_id=@mid ORDER BY d.id`)
  return r.recordset
}

export async function findById(id: number): Promise<DetalleMttoPieza | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_DETALLE} WHERE d.id=@id`)
  return r.recordset[0] ?? null
}

export async function findDisponibles(): Promise<LoteDisponible[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT l.id, l.pieza_id, p.numero_serie, p.descripcion, l.costo_unitario, l.cantidad_disponible, l.fecha_compra
    FROM lotes_pieza l
    JOIN piezas p ON p.id = l.pieza_id
    WHERE l.cantidad_disponible > 0
    ORDER BY p.numero_serie, l.fecha_compra
  `)
  return r.recordset
}

export async function getLoteInfo(loteId: number): Promise<{ costo_unitario: number; cantidad_disponible: number } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, loteId)
    .query('SELECT costo_unitario, cantidad_disponible FROM lotes_pieza WHERE id=@id')
  return r.recordset[0] ?? null
}

export async function getRaw(id: number): Promise<{ lote_id: number; cantidad: number } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT lote_id, cantidad FROM detalle_mtto_pieza WHERE id=@id')
  return r.recordset[0] ?? null
}

export async function create(
  mantenimientoId: number,
  data: DetalleMttoPiezaCreate,
  costoUnitario: number,
): Promise<DetalleMttoPieza> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const ins = await tx.request()
      .input('mid',   sql.Int,          mantenimientoId)
      .input('lid',   sql.Int,          data.lote_id)
      .input('cant',  sql.Int,          data.cantidad)
      .input('costo', sql.Decimal(18, 2), costoUnitario)
      .query(`
        INSERT INTO detalle_mtto_pieza (mantenimiento_id, lote_id, cantidad, costo_unitario)
        OUTPUT INSERTED.id
        VALUES (@mid, @lid, @cant, @costo)
      `)
    await tx.request()
      .input('lid',  sql.Int, data.lote_id)
      .input('cant', sql.Int, data.cantidad)
      .query('UPDATE lotes_pieza SET cantidad_disponible = cantidad_disponible - @cant WHERE id=@lid')
    await tx.commit()
    return (await findById(ins.recordset[0].id))!
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

export async function update(
  id: number,
  data: DetalleMttoPiezaUpdate,
  cantidadDelta: number,
): Promise<DetalleMttoPieza | null> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const sets: string[] = []
    const req = tx.request().input('id', sql.Int, id)
    if (data.cantidad !== undefined) { req.input('cant', sql.Int, data.cantidad); sets.push('cantidad=@cant') }
    if (data.costo_unitario !== undefined) { req.input('costo', sql.Decimal(18, 2), data.costo_unitario); sets.push('costo_unitario=@costo') }
    if (sets.length) {
      await req.query(`UPDATE detalle_mtto_pieza SET ${sets.join(',')} WHERE id=@id`)
    }
    if (cantidadDelta !== 0) {
      const detRaw = await tx.request().input('id', sql.Int, id)
        .query('SELECT lote_id FROM detalle_mtto_pieza WHERE id=@id')
      const loteId = detRaw.recordset[0].lote_id
      await tx.request()
        .input('lid',   sql.Int, loteId)
        .input('delta', sql.Int, cantidadDelta)
        .query('UPDATE lotes_pieza SET cantidad_disponible = cantidad_disponible - @delta WHERE id=@lid')
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
    const r = await tx.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM detalle_mtto_pieza OUTPUT DELETED.lote_id, DELETED.cantidad WHERE id=@id')
    const deleted = r.recordset[0]
    if (deleted) {
      await tx.request()
        .input('lid',  sql.Int, deleted.lote_id)
        .input('cant', sql.Int, deleted.cantidad)
        .query('UPDATE lotes_pieza SET cantidad_disponible = cantidad_disponible + @cant WHERE id=@lid')
    }
    await tx.commit()
    return !!deleted
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
