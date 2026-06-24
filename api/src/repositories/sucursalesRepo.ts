import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface Sucursal {
  id:        number
  nombre:    string
  ubicacion: string
}

export async function findAll(): Promise<Sucursal[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query('SELECT id, nombre, ubicacion FROM sucursales ORDER BY nombre')
  return r.recordset
}

export async function findById(id: number): Promise<Sucursal | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT id, nombre, ubicacion FROM sucursales WHERE id = @id')
  return r.recordset[0] ?? null
}

export async function create(nombre: string, ubicacion: string): Promise<Sucursal> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre',    sql.NVarChar(120), nombre)
    .input('ubicacion', sql.NVarChar(200), ubicacion)
    .query('INSERT INTO sucursales (nombre, ubicacion) OUTPUT INSERTED.id, INSERTED.nombre, INSERTED.ubicacion VALUES (@nombre, @ubicacion)')
  return r.recordset[0]
}

export async function update(id: number, nombre?: string, ubicacion?: string): Promise<Sucursal | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)
  if (nombre    !== undefined) { req.input('nombre',    sql.NVarChar(120), nombre);    sets.push('nombre=@nombre')       }
  if (ubicacion !== undefined) { req.input('ubicacion', sql.NVarChar(200), ubicacion); sets.push('ubicacion=@ubicacion') }
  if (!sets.length) return findById(id)
  const r = await req.query(
    `UPDATE sucursales SET ${sets.join(',')} OUTPUT INSERTED.id, INSERTED.nombre, INSERTED.ubicacion WHERE id=@id`
  )
  return r.recordset[0] ?? null
}

export async function countCamiones(id: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT COUNT(*) AS cnt FROM camiones WHERE sucursal_id = @id')
  return r.recordset[0].cnt
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM sucursales OUTPUT DELETED.id WHERE id = @id')
  return r.recordset.length > 0
}
