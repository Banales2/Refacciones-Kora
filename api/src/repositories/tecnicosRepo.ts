import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface Tecnico {
  id:        number
  nombre:    string
  ubicacion: string
  contacto:  string | null
}

const COLS = 'id, nombre, ubicacion, contacto'

export async function findAll(): Promise<Tecnico[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query(`SELECT ${COLS} FROM tecnicos ORDER BY nombre`)
  return r.recordset
}

export async function findById(id: number): Promise<Tecnico | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM tecnicos WHERE id = @id`)
  return r.recordset[0] ?? null
}

export async function create(
  nombre: string, ubicacion: string, contacto: string | null
): Promise<Tecnico> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre',    sql.NVarChar(40),  nombre)
    .input('ubicacion', sql.NVarChar(100), ubicacion)
    .input('contacto',  sql.NVarChar(40),  contacto ?? null)
    .query(`
      INSERT INTO tecnicos (nombre, ubicacion, contacto)
      OUTPUT INSERTED.id, INSERTED.nombre, INSERTED.ubicacion, INSERTED.contacto
      VALUES (@nombre, @ubicacion, @contacto)`)
  return r.recordset[0]
}

export async function update(
  id: number, nombre?: string, ubicacion?: string, contacto?: string | null
): Promise<Tecnico | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)
  if (nombre    !== undefined) { req.input('nombre',    sql.NVarChar(40),  nombre);            sets.push('nombre=@nombre')       }
  if (ubicacion !== undefined) { req.input('ubicacion', sql.NVarChar(100), ubicacion);         sets.push('ubicacion=@ubicacion') }
  if (contacto  !== undefined) { req.input('contacto',  sql.NVarChar(40),  contacto ?? null);  sets.push('contacto=@contacto')   }
  if (!sets.length) return findById(id)
  const r = await req.query(
    `UPDATE tecnicos SET ${sets.join(',')}
     OUTPUT INSERTED.id, INSERTED.nombre, INSERTED.ubicacion, INSERTED.contacto
     WHERE id=@id`
  )
  return r.recordset[0] ?? null
}

// ¿Ya existe un técnico con este nombre? exceptId excluye el propio al editar.
export async function existsNombre(nombre: string, exceptId?: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre', sql.NVarChar(40), nombre)
    .input('except', sql.Int,          exceptId ?? null)
    .query('SELECT TOP 1 id FROM tecnicos WHERE nombre = @nombre AND (@except IS NULL OR id <> @except)')
  return r.recordset.length > 0
}

export async function remove(id: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM tecnicos OUTPUT DELETED.id WHERE id = @id')
  return r.recordset.length > 0
}
