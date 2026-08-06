import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface Conductor {
  id:     number
  nombre: string
  // Licencia estatal. Los dos campos son texto porque el número trae letras y
  // la vigencia tampoco siempre se captura como fecha. Null mientras no se
  // capturen. Cuando entre el segundo tipo de licencia se agregan aquí sus
  // columnas con el mismo par número/vigencia.
  licencia_estatal_numero:   string | null
  licencia_estatal_vigencia: string | null
}

// Campos que el alta/edición puede mandar. Los de licencia son opcionales:
// undefined = no tocar, null = limpiar.
export interface ConductorInput {
  nombre?:                    string
  licencia_estatal_numero?:   string | null
  licencia_estatal_vigencia?: string | null
}

const COLS = 'id, nombre, licencia_estatal_numero, licencia_estatal_vigencia'
const OUT  = COLS.split(', ').map((c) => `INSERTED.${c}`).join(', ')

export async function findAll(): Promise<Conductor[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query(`SELECT ${COLS} FROM conductores ORDER BY nombre`)
  return r.recordset
}

export async function findById(id: number): Promise<Conductor | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM conductores WHERE id = @id`)
  return r.recordset[0] ?? null
}

export async function create(data: ConductorInput & { nombre: string }): Promise<Conductor> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre',   sql.NVarChar(100), data.nombre)
    .input('licNum',   sql.VarChar(30),   data.licencia_estatal_numero   ?? null)
    .input('licVig',   sql.VarChar(30),   data.licencia_estatal_vigencia ?? null)
    .query(`
      INSERT INTO conductores (nombre, licencia_estatal_numero, licencia_estatal_vigencia)
      OUTPUT ${OUT}
      VALUES (@nombre, @licNum, @licVig)`)
  return r.recordset[0]
}

export async function update(id: number, data: ConductorInput): Promise<Conductor | null> {
  const sets: string[] = []
  const pool = await getPool()
  const req = pool.request().input('id', sql.Int, id)

  if (data.nombre !== undefined) {
    req.input('nombre', sql.NVarChar(100), data.nombre); sets.push('nombre=@nombre')
  }
  if (data.licencia_estatal_numero !== undefined) {
    req.input('licNum', sql.VarChar(30), data.licencia_estatal_numero)
    sets.push('licencia_estatal_numero=@licNum')
  }
  if (data.licencia_estatal_vigencia !== undefined) {
    req.input('licVig', sql.VarChar(30), data.licencia_estatal_vigencia)
    sets.push('licencia_estatal_vigencia=@licVig')
  }
  if (sets.length === 0) return findById(id)

  const r = await req.query(`
    UPDATE conductores SET ${sets.join(', ')}
    OUTPUT ${OUT}
    WHERE id=@id`)
  return r.recordset[0] ?? null
}

// ¿Ya existe un conductor con este nombre? exceptId excluye el propio al editar.
export async function existsNombre(nombre: string, exceptId?: number): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre', sql.NVarChar(100), nombre)
    .input('except', sql.Int,           exceptId ?? null)
    .query('SELECT TOP 1 id FROM conductores WHERE nombre = @nombre AND (@except IS NULL OR id <> @except)')
  return r.recordset.length > 0
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
