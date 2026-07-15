import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface Proveedor {
  id:       number
  nombre:   string
  contacto: string | null
}

export async function findAll(): Promise<Proveedor[]> {
  const pool = await getPool()
  const result = await pool.request()
    .query('SELECT id, nombre, contacto FROM proveedores ORDER BY nombre')
  return result.recordset
}

export async function findById(id: number): Promise<Proveedor | null> {
  const pool = await getPool()
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT id, nombre, contacto FROM proveedores WHERE id = @id')
  return result.recordset[0] ?? null
}

export async function create(nombre: string, contacto: string | null): Promise<Proveedor> {
  const pool = await getPool()
  const result = await pool.request()
    .input('nombre',   sql.NVarChar(100), nombre)
    .input('contacto', sql.NVarChar(100), contacto ?? null)
    .query('INSERT INTO proveedores (nombre, contacto) OUTPUT INSERTED.id, INSERTED.nombre, INSERTED.contacto VALUES (@nombre, @contacto)')
  return result.recordset[0]
}

export async function update(id: number, nombre?: string, contacto?: string | null): Promise<Proveedor | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)
  if (nombre   !== undefined) { req.input('nombre',   sql.NVarChar(100), nombre);        sets.push('nombre=@nombre') }
  if (contacto !== undefined) { req.input('contacto', sql.NVarChar(100), contacto ?? null); sets.push('contacto=@contacto') }
  if (!sets.length) return findById(id)
  const result = await req.query(
    `UPDATE proveedores SET ${sets.join(',')} OUTPUT INSERTED.id, INSERTED.nombre, INSERTED.contacto WHERE id=@id`
  )
  return result.recordset[0] ?? null
}

// ¿Ya existe un proveedor con este nombre? exceptId excluye el propio al editar.
export async function existsNombre(nombre: string, exceptId?: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre', sql.NVarChar(100), nombre)
    .input('except', sql.Int,           exceptId ?? null)
    .query('SELECT TOP 1 id FROM proveedores WHERE nombre = @nombre AND (@except IS NULL OR id <> @except)')
  return r.recordset.length > 0
}

export async function countLotes(id: number): Promise<number> {
  const pool = await getPool()
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT COUNT(*) AS cnt FROM lotes_pieza WHERE proveedor_id = @id')
  return result.recordset[0].cnt
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM proveedores OUTPUT DELETED.id WHERE id = @id')
  return result.recordset.length > 0
}
