import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface Modelo {
  id:         number
  marca:      string
  nombre:     string
  created_at: string
  updated_at: string
}

const COLS = 'id, marca, nombre, created_at, updated_at'

export async function findAll(): Promise<Modelo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query(`SELECT ${COLS} FROM modelos ORDER BY marca, nombre`)
  return r.recordset
}

export async function findById(id: number): Promise<Modelo | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM modelos WHERE id = @id`)
  return r.recordset[0] ?? null
}

export async function create(marca: string, nombre: string): Promise<Modelo> {
  const pool = await getPool()
  const r = await pool.request()
    .input('marca',  sql.NVarChar(80),  marca)
    .input('nombre', sql.NVarChar(120), nombre)
    .query(`INSERT INTO modelos (marca, nombre) OUTPUT INSERTED.${COLS} VALUES (@marca, @nombre)`)
  return r.recordset[0]
}

export async function update(id: number, marca?: string, nombre?: string): Promise<Modelo | null> {
  const pool = await getPool()
  const sets: string[] = ['updated_at=SYSDATETIME()']
  const req = pool.request().input('id', sql.Int, id)
  if (marca  !== undefined) { req.input('marca',  sql.NVarChar(80),  marca);  sets.push('marca=@marca')   }
  if (nombre !== undefined) { req.input('nombre', sql.NVarChar(120), nombre); sets.push('nombre=@nombre') }
  const r = await req.query(
    `UPDATE modelos SET ${sets.join(',')} OUTPUT INSERTED.${COLS} WHERE id=@id`
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
