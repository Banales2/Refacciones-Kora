import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface Gasolinera {
  id:        number
  nombre:    string
  ubicacion: string
}

export async function findAll(): Promise<Gasolinera[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query('SELECT id, nombre, ubicacion FROM gasolineras ORDER BY nombre')
  return r.recordset
}

export async function findById(id: number): Promise<Gasolinera | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT id, nombre, ubicacion FROM gasolineras WHERE id = @id')
  return r.recordset[0] ?? null
}

export async function create(nombre: string, ubicacion: string): Promise<Gasolinera> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre',    sql.NVarChar(120), nombre)
    .input('ubicacion', sql.NVarChar(200), ubicacion)
    .query('INSERT INTO gasolineras (nombre, ubicacion) OUTPUT INSERTED.id, INSERTED.nombre, INSERTED.ubicacion VALUES (@nombre, @ubicacion)')
  return r.recordset[0]
}

export async function update(id: number, nombre?: string, ubicacion?: string): Promise<Gasolinera | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)
  if (nombre    !== undefined) { req.input('nombre',    sql.NVarChar(120), nombre);    sets.push('nombre=@nombre')       }
  if (ubicacion !== undefined) { req.input('ubicacion', sql.NVarChar(200), ubicacion); sets.push('ubicacion=@ubicacion') }
  if (!sets.length) return findById(id)
  const r = await req.query(
    `UPDATE gasolineras SET ${sets.join(',')} OUTPUT INSERTED.id, INSERTED.nombre, INSERTED.ubicacion WHERE id=@id`
  )
  return r.recordset[0] ?? null
}

export async function countRecargas(id: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT COUNT(*) AS cnt FROM recargas_combustible WHERE gasolinera_id = @id')
  return r.recordset[0].cnt
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM gasolineras OUTPUT DELETED.id WHERE id = @id')
  return r.recordset.length > 0
}
