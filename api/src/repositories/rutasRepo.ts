import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface Ruta {
  id:        number
  nombre:    string
  ubicacion: string
}

export async function findAll(): Promise<Ruta[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query('SELECT id, nombre, ubicacion FROM rutas ORDER BY nombre')
  return r.recordset
}

export async function findById(id: number): Promise<Ruta | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT id, nombre, ubicacion FROM rutas WHERE id = @id')
  return r.recordset[0] ?? null
}

export async function create(nombre: string, ubicacion: string): Promise<Ruta> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre',    sql.NVarChar(120), nombre)
    .input('ubicacion', sql.NVarChar(200), ubicacion)
    .query('INSERT INTO rutas (nombre, ubicacion) OUTPUT INSERTED.id, INSERTED.nombre, INSERTED.ubicacion VALUES (@nombre, @ubicacion)')
  return r.recordset[0]
}

export async function update(id: number, nombre?: string, ubicacion?: string): Promise<Ruta | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)
  if (nombre    !== undefined) { req.input('nombre',    sql.NVarChar(120), nombre);    sets.push('nombre=@nombre')       }
  if (ubicacion !== undefined) { req.input('ubicacion', sql.NVarChar(200), ubicacion); sets.push('ubicacion=@ubicacion') }
  if (!sets.length) return findById(id)
  const r = await req.query(
    `UPDATE rutas SET ${sets.join(',')} OUTPUT INSERTED.id, INSERTED.nombre, INSERTED.ubicacion WHERE id=@id`
  )
  return r.recordset[0] ?? null
}

// ¿Ya existe un traslado con este nombre? exceptId excluye el propio al editar.
export async function existsNombre(nombre: string, exceptId?: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre', sql.NVarChar(120), nombre)
    .input('except', sql.Int,           exceptId ?? null)
    .query('SELECT TOP 1 id FROM rutas WHERE nombre = @nombre AND (@except IS NULL OR id <> @except)')
  return r.recordset.length > 0
}

export async function countTractocamiones(id: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT COUNT(*) AS cnt FROM tractocamiones WHERE ruta_id = @id')
  return r.recordset[0].cnt
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM rutas OUTPUT DELETED.id WHERE id = @id')
  return r.recordset.length > 0
}
