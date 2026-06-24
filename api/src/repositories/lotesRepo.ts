import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { LoteConProveedor } from '../types/domain'
import { LoteCreate, LoteUpdate } from '../schemas/loteSchema'

const SELECT_LOTE = `
  SELECT l.id, l.pieza_id, l.proveedor_id, l.fecha_compra, l.costo_unitario,
         l.cantidad_inicial, l.cantidad_disponible, l.num_factura,
         pr.nombre AS proveedor
  FROM lotes_pieza l
  JOIN proveedores pr ON pr.id = l.proveedor_id
`

export async function findById(id: number): Promise<LoteConProveedor | null> {
  const pool = await getPool()
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query(`${SELECT_LOTE} WHERE l.id = @id`)
  return result.recordset[0] ?? null
}

export async function create(piezaId: number, data: LoteCreate): Promise<LoteConProveedor> {
  const pool = await getPool()
  const result = await pool.request()
    .input('pieza_id', sql.Int, piezaId)
    .input('proveedor_id', sql.Int, data.proveedor_id)
    .input('fecha_compra', sql.Date, data.fecha_compra)
    .input('costo_unitario', sql.Decimal(18, 2), data.costo_unitario)
    .input('cantidad_inicial', sql.Int, data.cantidad_inicial)
    .input('num_factura', sql.NVarChar(100), data.num_factura ?? null)
    .query(`
      INSERT INTO lotes_pieza
        (pieza_id, proveedor_id, fecha_compra, costo_unitario, cantidad_inicial, cantidad_disponible, num_factura)
      OUTPUT INSERTED.id
      VALUES (@pieza_id, @proveedor_id, @fecha_compra, @costo_unitario, @cantidad_inicial, @cantidad_inicial, @num_factura)
    `)
  return findById(result.recordset[0].id) as Promise<LoteConProveedor>
}

export async function getRaw(id: number): Promise<{ cantidad_inicial: number; cantidad_disponible: number } | null> {
  const pool = await getPool()
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT cantidad_inicial, cantidad_disponible FROM lotes_pieza WHERE id = @id')
  return result.recordset[0] ?? null
}

export async function update(id: number, data: LoteUpdate, newCantidadDisponible?: number): Promise<LoteConProveedor | null> {
  const sets: string[] = []
  const pool = await getPool()
  const req = pool.request().input('id', sql.Int, id)

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
    req.input('cantidad_disponible', sql.Int, newCantidadDisponible!)
    sets.push('cantidad_inicial = @cantidad_inicial')
    sets.push('cantidad_disponible = @cantidad_disponible')
  }
  if ('num_factura' in data) {
    req.input('num_factura', sql.NVarChar(100), data.num_factura ?? null)
    sets.push('num_factura = @num_factura')
  }

  if (sets.length === 0) return findById(id)

  await req.query(`UPDATE lotes_pieza SET ${sets.join(', ')} WHERE id = @id`)
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
