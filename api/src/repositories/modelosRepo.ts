import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface Modelo {
  id:     number
  marca:  string
  nombre: string
}

export async function findAll(): Promise<Modelo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query('SELECT id, marca, nombre FROM modelos ORDER BY marca, nombre')
  return r.recordset
}

export async function findById(id: number): Promise<Modelo | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT id, marca, nombre FROM modelos WHERE id = @id')
  return r.recordset[0] ?? null
}

export async function create(marca: string, nombre: string): Promise<Modelo> {
  const pool = await getPool()
  const r = await pool.request()
    .input('marca',  sql.NVarChar(80), marca)
    .input('nombre', sql.NVarChar(80), nombre)
    .query('INSERT INTO modelos (marca, nombre) OUTPUT INSERTED.id, INSERTED.marca, INSERTED.nombre VALUES (@marca, @nombre)')
  return r.recordset[0]
}

export async function update(id: number, marca?: string, nombre?: string): Promise<Modelo | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)
  if (marca  !== undefined) { req.input('marca',  sql.NVarChar(80), marca);  sets.push('marca=@marca')  }
  if (nombre !== undefined) { req.input('nombre', sql.NVarChar(80), nombre); sets.push('nombre=@nombre') }
  if (!sets.length) return findById(id)
  const r = await req.query(
    `UPDATE modelos SET ${sets.join(',')} OUTPUT INSERTED.id, INSERTED.marca, INSERTED.nombre WHERE id=@id`
  )
  return r.recordset[0] ?? null
}

export async function countVehiculos(id: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT COUNT(*) AS cnt FROM vehiculos WHERE modelo_id = @id')
  return r.recordset[0].cnt
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM modelos OUTPUT DELETED.id WHERE id = @id')
  return r.recordset.length > 0
}
