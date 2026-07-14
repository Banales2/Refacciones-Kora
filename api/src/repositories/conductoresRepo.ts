import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface Conductor {
  id:     number
  nombre: string
}

export async function findAll(): Promise<Conductor[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query('SELECT id, nombre FROM conductores ORDER BY nombre')
  return r.recordset
}

export async function findById(id: number): Promise<Conductor | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT id, nombre FROM conductores WHERE id = @id')
  return r.recordset[0] ?? null
}

export async function create(nombre: string): Promise<Conductor> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre', sql.NVarChar(120), nombre)
    .query('INSERT INTO conductores (nombre) OUTPUT INSERTED.id, INSERTED.nombre VALUES (@nombre)')
  return r.recordset[0]
}

export async function update(id: number, nombre?: string): Promise<Conductor | null> {
  const pool = await getPool()
  if (nombre === undefined) return findById(id)
  const r = await pool.request()
    .input('id',     sql.Int, id)
    .input('nombre', sql.NVarChar(120), nombre)
    .query('UPDATE conductores SET nombre=@nombre OUTPUT INSERTED.id, INSERTED.nombre WHERE id=@id')
  return r.recordset[0] ?? null
}

export async function countRecargas(id: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT COUNT(*) AS cnt FROM recargas_combustible WHERE conductor_id = @id')
  return r.recordset[0].cnt
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM conductores OUTPUT DELETED.id WHERE id = @id')
  return r.recordset.length > 0
}
