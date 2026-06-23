import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { Pieza } from '../types/domain'
import { RefaccionCreate, RefaccionUpdate } from '../schemas/refaccionSchema'

export async function findAll(params: {
  offset: number
  pageSize: number
  search?: string
}): Promise<{ data: Pieza[]; total: number }> {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('search', params.search ? `%${params.search}%` : null)
    .input('offset', params.offset)
    .input('pageSize', params.pageSize)
    .query(`
      SELECT id, numero_serie, descripcion FROM piezas
      WHERE (@search IS NULL OR numero_serie LIKE @search OR descripcion LIKE @search)
      ORDER BY numero_serie
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

      SELECT COUNT(*) AS total FROM piezas
      WHERE (@search IS NULL OR numero_serie LIKE @search OR descripcion LIKE @search);
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
