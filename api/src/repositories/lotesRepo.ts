import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { LoteConProveedor } from '../types/domain'
import { LoteCreate, LoteUpdate } from '../schemas/loteSchema'
import { disponibleDelLote } from './inventarioSql'

// `cantidad_disponible` ya no es una columna que se lea: es la suma de las
// existencias del lote en todas las sucursales (migración 002).
const SELECT_LOTE = `
  SELECT l.id, l.pieza_id, l.proveedor_id, l.fecha_compra, l.costo_unitario,
         l.cantidad_inicial, ${disponibleDelLote('l')} AS cantidad_disponible,
         l.num_factura, l.sucursal_id,
         l.comprado_por, l.autorizado_por,
         pr.nombre AS proveedor,
         s.nombre AS sucursal
  FROM lotes_pieza l
  JOIN proveedores pr ON pr.id = l.proveedor_id
  LEFT JOIN sucursales s ON s.id = l.sucursal_id
`

export async function findById(id: number): Promise<LoteConProveedor | null> {
  const pool = await getPool()
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_LOTE} WHERE l.id = @id`)
  return result.recordset[0] ?? null
}

// Un lote entra completo a la sucursal que lo recibió. Repartirlo entre varias
// es un traspaso posterior, no parte de la compra.
//
// `cantidad_disponible` se sigue escribiendo mientras la columna exista, para
// que quien mire la tabla a mano no vea un cero engañoso; nadie la lee.
export async function create(
  piezaId: number, data: LoteCreate, autorizadoPor: string
): Promise<LoteConProveedor> {
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  try {
    const result = await tx.request()
      .input('pieza_id', sql.Int, piezaId)
      .input('proveedor_id', sql.Int, data.proveedor_id)
      .input('sucursal_id', sql.Int, data.sucursal_id)
      .input('fecha_compra', sql.Date, data.fecha_compra)
      .input('costo_unitario', sql.Decimal(18, 2), data.costo_unitario)
      .input('cantidad_inicial', sql.Int, data.cantidad_inicial)
      .input('num_factura', sql.NVarChar(100), data.num_factura ?? null)
      .input('comprado_por', sql.NVarChar(120), data.comprado_por)
      .input('autorizado_por', sql.NVarChar(120), autorizadoPor)
      .query(`
        INSERT INTO lotes_pieza
          (pieza_id, proveedor_id, sucursal_id, fecha_compra, costo_unitario,
           cantidad_inicial, cantidad_disponible,
           num_factura, comprado_por, autorizado_por)
        OUTPUT INSERTED.id
        VALUES (@pieza_id, @proveedor_id, @sucursal_id, @fecha_compra, @costo_unitario,
                @cantidad_inicial, @cantidad_inicial,
                @num_factura, @comprado_por, @autorizado_por)
      `)
    const loteId = result.recordset[0].id as number

    await tx.request()
      .input('lote_id', sql.Int, loteId)
      .input('sucursal_id', sql.Int, data.sucursal_id)
      .input('cantidad', sql.Int, data.cantidad_inicial)
      .query(`
        INSERT INTO existencias_lote (lote_id, sucursal_id, cantidad)
        VALUES (@lote_id, @sucursal_id, @cantidad)`)

    await tx.commit()
    return findById(loteId) as Promise<LoteConProveedor>
  } catch (err) {
    await tx.rollback()
    throw err
  }
}

export async function getRaw(id: number): Promise<{
  cantidad_inicial: number
  cantidad_disponible: number
  sucursal_id: number | null
  /** Lo que queda en la sucursal donde el lote se recibió. */
  disponible_en_origen: number
} | null> {
  const pool = await getPool()
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT
        l.cantidad_inicial,
        ${disponibleDelLote('l')} AS cantidad_disponible,
        l.sucursal_id,
        COALESCE((SELECT ex.cantidad FROM existencias_lote ex
                  WHERE ex.lote_id = l.id AND ex.sucursal_id = l.sucursal_id), 0) AS disponible_en_origen
      FROM lotes_pieza l
      WHERE l.id = @id`)
  return result.recordset[0] ?? null
}

/**
 * `deltaCantidad` es cuánto cambió `cantidad_inicial`. Se aplica a la
 * existencia de la sucursal donde el lote se recibió, que es donde entraron (o
 * de donde nunca debieron salir) las unidades corregidas. El service ya
 * verificó que no deje esa existencia en negativo.
 */
export async function update(
  id: number, data: LoteUpdate, deltaCantidad?: number,
): Promise<LoteConProveedor | null> {
  const sets: string[] = []
  const pool = await getPool()
  const tx = pool.transaction()
  await tx.begin()
  const req = tx.request().input('id', sql.Int, id)

  if (data.proveedor_id !== undefined) {
    req.input('proveedor_id', sql.Int, data.proveedor_id)
    sets.push('proveedor_id = @proveedor_id')
  }
  if (data.fecha_compra !== undefined) {
    req.input('fecha_compra', sql.Date, data.fecha_compra)
    sets.push('fecha_compra = @fecha_compra')
  }
  if (data.costo_unitario !== undefined) {
    req.input('costo_unitario', sql.Decimal(18, 2), data.costo_unitario)
    sets.push('costo_unitario = @costo_unitario')
  }
  if (data.cantidad_inicial !== undefined) {
    req.input('cantidad_inicial', sql.Int, data.cantidad_inicial)
    sets.push('cantidad_inicial = @cantidad_inicial')
    // Se arrastra la columna obsoleta para que no quede en un valor mentiroso
    // mientras exista; el stock real se ajusta abajo, en las existencias.
    sets.push('cantidad_disponible = cantidad_disponible + @delta')
    req.input('delta', sql.Int, deltaCantidad ?? 0)
  }
  if ('num_factura' in data) {
    req.input('num_factura', sql.NVarChar(100), data.num_factura ?? null)
    sets.push('num_factura = @num_factura')
  }
  // `autorizado_por` no está aquí a propósito: registra quién dio de alta la
  // compra y no cambia. `comprado_por` sí se corrige, es un dato del lote.
  if (data.comprado_por !== undefined) {
    req.input('comprado_por', sql.NVarChar(120), data.comprado_por)
    sets.push('comprado_por = @comprado_por')
  }

  if (sets.length === 0) {
    await tx.rollback()
    return findById(id)
  }

  try {
    await req.query(`UPDATE lotes_pieza SET ${sets.join(', ')} WHERE id = @id`)

    if (deltaCantidad) {
      // Puede no haber fila de existencia todavía (lote agotado al que se le
      // corrige la cantidad hacia arriba), de ahí el UPDATE-then-INSERT.
      await tx.request()
        .input('id',    sql.Int, id)
        .input('delta', sql.Int, deltaCantidad)
        .query(`
          UPDATE ex SET ex.cantidad = ex.cantidad + @delta
          FROM existencias_lote ex
          JOIN lotes_pieza l ON l.id = ex.lote_id AND l.sucursal_id = ex.sucursal_id
          WHERE ex.lote_id = @id;

          IF @@ROWCOUNT = 0
            INSERT INTO existencias_lote (lote_id, sucursal_id, cantidad)
            SELECT l.id, l.sucursal_id, @delta
            FROM lotes_pieza l
            WHERE l.id = @id AND l.sucursal_id IS NOT NULL;`)
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
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM lotes_pieza OUTPUT DELETED.id WHERE id = @id')
  return result.recordset.length > 0
}

export async function findProveedores(): Promise<{ id: number; nombre: string }[]> {
  const pool = await getPool()
  const result = await pool.request()
    .query('SELECT id, nombre FROM proveedores ORDER BY nombre')
  return result.recordset
}
