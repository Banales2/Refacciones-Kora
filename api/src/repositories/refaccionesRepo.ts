import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { Pieza, PiezaConCantidad, LoteConProveedor } from '../types/domain'
import { RefaccionCreate, RefaccionUpdate, SearchBy } from '../schemas/refaccionSchema'

export async function findAll(params: {
  offset: number
  pageSize: number
  search?: string
  searchBy?: SearchBy
}): Promise<{ data: PiezaConCantidad[]; total: number }> {
  const pool = await getPool()
  const req = pool.request()
    .input('offset', params.offset)
    .input('pageSize', params.pageSize)

  let mainWhere = ''
  let countWhere = ''
  if (params.search) {
    req.input('search', `%${params.search}%`)
    if (params.searchBy === 'numero_serie') {
      mainWhere = 'WHERE p.numero_serie LIKE @search'
      countWhere = 'WHERE numero_serie LIKE @search'
    } else if (params.searchBy === 'descripcion') {
      mainWhere = 'WHERE p.descripcion LIKE @search'
      countWhere = 'WHERE descripcion LIKE @search'
    } else {
      mainWhere = 'WHERE (p.numero_serie LIKE @search OR p.descripcion LIKE @search)'
      countWhere = 'WHERE (numero_serie LIKE @search OR descripcion LIKE @search)'
    }
  }

  const result = await req.query(`
    SELECT
      p.id, p.numero_serie, p.descripcion,
      COALESCE(SUM(l.cantidad_disponible), 0) AS cantidad_total
    FROM piezas p
    LEFT JOIN lotes_pieza l ON l.pieza_id = p.id
    ${mainWhere}
    GROUP BY p.id, p.numero_serie, p.descripcion
    ORDER BY p.numero_serie
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(*) AS total FROM piezas
    ${countWhere};
  `)
  return { data: result.recordsets[0], total: result.recordsets[1][0].total }
}

export async function findById(id: number): Promise<Pieza | null> {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT id, numero_serie, descripcion FROM piezas WHERE id = @id')
  return result.recordset[0] ?? null
}

export async function findByNumeroSerie(numeroSerie: string): Promise<Pieza | null> {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('ns', sql.NVarChar(80), numeroSerie)
    .query('SELECT id, numero_serie, descripcion FROM piezas WHERE numero_serie = @ns')
  return result.recordset[0] ?? null
}

export async function findLotesByPiezaId(piezaId: number): Promise<LoteConProveedor[]> {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('piezaId', sql.Int, piezaId)
    .query(`
      SELECT
        l.id, l.pieza_id, l.proveedor_id, l.fecha_compra, l.costo_unitario,
        l.cantidad_inicial, l.cantidad_disponible,
        l.num_factura, pr.nombre AS proveedor
      FROM lotes_pieza l
      JOIN proveedores pr ON pr.id = l.proveedor_id
      WHERE l.pieza_id = @piezaId
      ORDER BY l.fecha_compra DESC
    `)
  return result.recordset
}

export async function create(data: RefaccionCreate): Promise<Pieza> {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('ns', sql.NVarChar(80), data.numero_serie)
    .input('desc', sql.NVarChar(300), data.descripcion)
    .query(`
      INSERT INTO piezas (numero_serie, descripcion)
      OUTPUT INSERTED.id, INSERTED.numero_serie, INSERTED.descripcion
      VALUES (@ns, @desc)
    `)
  return result.recordset[0]
}

export async function update(id: number, data: RefaccionUpdate): Promise<Pieza | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)

  if (data.numero_serie !== undefined) { req.input('ns', sql.NVarChar(80), data.numero_serie); sets.push('numero_serie = @ns') }
  if (data.descripcion !== undefined) { req.input('desc', sql.NVarChar(300), data.descripcion); sets.push('descripcion = @desc') }

  if (sets.length === 0) return findById(id)

  const result = await req.query(`
    UPDATE piezas SET ${sets.join(', ')}
    OUTPUT INSERTED.id, INSERTED.numero_serie, INSERTED.descripcion
    WHERE id = @id
  `)
  return result.recordset[0] ?? null
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('DELETE FROM piezas OUTPUT DELETED.id WHERE id = @id')
  return result.recordset.length > 0
}
