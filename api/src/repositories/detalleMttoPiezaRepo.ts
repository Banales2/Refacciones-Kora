import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { DetalleMttoPiezaCreate, DetalleMttoPiezaUpdate } from '../schemas/detalleMttoPiezaSchema'
import { moverExistencia } from './inventarioSql'

export interface DetalleMttoPieza {
  id:               number
  mantenimiento_id: number
  lote_id:          number
  cantidad:         number
  costo_unitario:   number
  pieza_id:         number
  tipo_pieza_id:    number | null
  numero_serie:     string
  descripcion:      string
  lote_disponible:  number
  sucursal_id:      number | null
  sucursal:         string | null
  // Cuántas de estas piezas ya se montaron en la unidad colgándose de este
  // renglón. Lo que falta por montar es `cantidad - montadas`, y mientras sea
  // mayor que cero el consumo sigue apareciendo como pendiente en el vehículo.
  montadas:         number
}

export interface LoteDisponible {
  id:                  number
  pieza_id:            number
  numero_serie:        string
  descripcion:         string
  costo_unitario:      number
  cantidad_disponible: number
  fecha_compra:        string
  sucursal_id:         number
  sucursal:            string
}

// De qué sucursal salió este consumo. Los consumos anteriores al inventario por
// sucursal tienen `sucursal_id` en NULL; para ellos vale la sucursal donde el
// lote se recibió, que es justo donde la migración 002 puso todo el stock.
const SUCURSAL_DEL_DETALLE = 'COALESCE(d.sucursal_id, l.sucursal_id)'

const SELECT_DETALLE = `
  SELECT d.id, d.mantenimiento_id, d.lote_id, d.cantidad, d.costo_unitario,
         p.id AS pieza_id, p.tipo_pieza_id, p.numero_serie, p.descripcion,
         (SELECT COUNT(*) FROM instalaciones_pieza ip
          WHERE ip.detalle_mtto_pieza_id = d.id) AS montadas,
         ${SUCURSAL_DEL_DETALLE} AS sucursal_id,
         s.nombre AS sucursal,
         -- Lo que queda del lote en esa sucursal, que es el tope real para
         -- aumentar la cantidad de este renglón.
         COALESCE((SELECT ex.cantidad FROM existencias_lote ex
                   WHERE ex.lote_id = d.lote_id
                     AND ex.sucursal_id = ${SUCURSAL_DEL_DETALLE}), 0) AS lote_disponible
  FROM detalle_mtto_pieza d
  JOIN lotes_pieza l ON l.id = d.lote_id
  JOIN piezas p ON p.id = l.pieza_id
  LEFT JOIN sucursales s ON s.id = ${SUCURSAL_DEL_DETALLE}
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

// Una opción por (lote, sucursal): el mismo lote puede estar repartido y hay
// que elegir de dónde sale la pieza, no solo de qué compra.
export async function findDisponibles(): Promise<LoteDisponible[]> {
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT l.id, l.pieza_id, p.numero_serie, p.descripcion, l.costo_unitario,
           ex.cantidad AS cantidad_disponible, l.fecha_compra,
           ex.sucursal_id, s.nombre AS sucursal
    FROM existencias_lote ex
    JOIN lotes_pieza l ON l.id = ex.lote_id
    JOIN piezas p      ON p.id = l.pieza_id
    JOIN sucursales s  ON s.id = ex.sucursal_id
    WHERE ex.cantidad > 0
    ORDER BY p.numero_serie, s.nombre, l.fecha_compra
  `)
  return r.recordset
}

/** Costo y existencia de un lote en una sucursal, para validar antes de consumir. */
export async function getLoteInfo(
  loteId: number, sucursalId: number,
): Promise<{ costo_unitario: number; cantidad_disponible: number } | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',  sql.Int, loteId)
    .input('suc', sql.Int, sucursalId)
    .query(`
      SELECT l.costo_unitario,
             COALESCE((SELECT ex.cantidad FROM existencias_lote ex
                       WHERE ex.lote_id = l.id AND ex.sucursal_id = @suc), 0) AS cantidad_disponible
      FROM lotes_pieza l
      WHERE l.id = @id`)
  return r.recordset[0] ?? null
}

export async function getRaw(id: number): Promise<{
  lote_id: number; cantidad: number; sucursal_id: number | null
} | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT d.lote_id, d.cantidad, ${SUCURSAL_DEL_DETALLE} AS sucursal_id
      FROM detalle_mtto_pieza d
      JOIN lotes_pieza l ON l.id = d.lote_id
      WHERE d.id = @id`)
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
      .input('suc',   sql.Int,          data.sucursal_id)
      .input('cant',  sql.Int,          data.cantidad)
      .input('costo', sql.Decimal(18, 2), costoUnitario)
      .query(`
        INSERT INTO detalle_mtto_pieza (mantenimiento_id, lote_id, sucursal_id, cantidad, costo_unitario)
        OUTPUT INSERTED.id
        VALUES (@mid, @lid, @suc, @cant, @costo)
      `)
    await moverExistencia(tx, data.lote_id, data.sucursal_id, -data.cantidad)
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
      // El renglón se descuenta de donde salió, no de donde esté el resto del
      // lote: si vino de Vallarta, corregir la cantidad toca Vallarta.
      const detRaw = await tx.request().input('id', sql.Int, id)
        .query(`
          SELECT d.lote_id, ${SUCURSAL_DEL_DETALLE} AS sucursal_id
          FROM detalle_mtto_pieza d
          JOIN lotes_pieza l ON l.id = d.lote_id
          WHERE d.id = @id`)
      const { lote_id, sucursal_id } = detRaw.recordset[0]
      await moverExistencia(tx, lote_id, sucursal_id, -cantidadDelta)
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
    // La sucursal se lee antes del DELETE: después ya no hay renglón del que
    // sacarla, y OUTPUT no alcanza el COALESCE con el lote.
    const previo = await tx.request().input('id', sql.Int, id)
      .query(`
        SELECT d.lote_id, d.cantidad, ${SUCURSAL_DEL_DETALLE} AS sucursal_id
        FROM detalle_mtto_pieza d
        JOIN lotes_pieza l ON l.id = d.lote_id
        WHERE d.id = @id`)
    const fila = previo.recordset[0]

    const r = await tx.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM detalle_mtto_pieza OUTPUT DELETED.id WHERE id=@id')
    const borrado = r.recordset.length > 0

    if (borrado && fila) {
      await moverExistencia(tx, fila.lote_id, fila.sucursal_id, fila.cantidad)
    }
    await tx.commit()
    return borrado
  } catch (err) {
    await tx.rollback()
    throw err
  }
}
