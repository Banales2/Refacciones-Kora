import * as sql from 'mssql'
import { getPool } from '../shared/db'

// Tipo de pieza: lo que un modelo necesita ("filtro de aire"), sin decir cuál
// pieza concreta. La pieza que lo cubre se elige por vehículo.
export interface TipoPieza {
  id:     number
  nombre: string
}

export async function findAll(): Promise<TipoPieza[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query('SELECT id, nombre FROM tipos_pieza ORDER BY nombre')
  return r.recordset
}

export async function findById(id: number): Promise<TipoPieza | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT id, nombre FROM tipos_pieza WHERE id = @id')
  return r.recordset[0] ?? null
}

export async function create(nombre: string): Promise<TipoPieza> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre', sql.NVarChar(80), nombre)
    .query('INSERT INTO tipos_pieza (nombre) OUTPUT INSERTED.id, INSERTED.nombre VALUES (@nombre)')
  return r.recordset[0]
}

export async function update(id: number, nombre: string): Promise<TipoPieza | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id',     sql.Int,          id)
    .input('nombre', sql.NVarChar(80), nombre)
    .query('UPDATE tipos_pieza SET nombre = @nombre OUTPUT INSERTED.id, INSERTED.nombre WHERE id = @id')
  return r.recordset[0] ?? null
}

// ¿Ya existe un tipo con este nombre? exceptId excluye el propio al editar.
export async function existsNombre(nombre: string, exceptId?: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre', sql.NVarChar(80), nombre)
    .input('except', sql.Int,          exceptId ?? null)
    .query('SELECT TOP 1 id FROM tipos_pieza WHERE nombre = @nombre AND (@except IS NULL OR id <> @except)')
  return r.recordset.length > 0
}

// Referencias que impiden borrar el tipo: modelos que lo piden, vehículos que lo
// necesitan por su cuenta o que ya eligieron pieza para él, y piezas del
// catálogo marcadas con este tipo.
export async function countReferencias(id: number): Promise<{ modelos: number; vehiculos: number; piezas: number }> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM tipos_pieza_modelo WHERE tipo_pieza_id = @id) AS modelos,
        -- Un vehículo puede requerir el tipo sin haber elegido pieza todavía, y
        -- ambas tablas lo referencian: el UNION lo cuenta una sola vez.
        (SELECT COUNT(*) FROM (
          SELECT vehiculo_id FROM piezas_vehiculo      WHERE tipo_pieza_id = @id
          UNION
          SELECT vehiculo_id FROM tipos_pieza_vehiculo WHERE tipo_pieza_id = @id
        ) AS refs)                                                          AS vehiculos,
        (SELECT COUNT(*) FROM piezas             WHERE tipo_pieza_id = @id) AS piezas`)
  return r.recordset[0]
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM tipos_pieza OUTPUT DELETED.id WHERE id = @id')
  return r.recordset.length > 0
}
