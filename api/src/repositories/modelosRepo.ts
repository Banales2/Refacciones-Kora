import * as sql from 'mssql'
import { getPool } from '../shared/db'

export interface Modelo {
  id:               number
  marca:            string
  nombre:           string
  // Año del modelo. Permite distinguir dos modelos de igual marca/nombre pero
  // año distinto. Null en modelos antiguos que no lo capturaron.
  anio:             number | null
  // Tipos de vehículo que este modelo puede generar. Vacío = sin restricción
  // (se permiten todos). Evita, p. ej., crear un montacargas (sin kilometraje)
  // a partir de un modelo cuya plantilla tiene requerimientos por kilometraje.
  tipos_permitidos: string[]
  created_at:       string
  updated_at:       string
}

const COLS = 'id, marca, nombre, anio, tipos_permitidos, created_at, updated_at'

// En la BD se guarda como CSV ("camion,utilitario"); hacia fuera se expone como
// arreglo. NULL/'' significa "sin restricción".
function parseTipos(v: string | null): string[] {
  if (!v) return []
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

function serializeTipos(tipos: string[] | null | undefined): string | null {
  if (!tipos || tipos.length === 0) return null
  return tipos.join(',')
}

// Fila cruda de la BD: tipos_permitidos llega como CSV (o NULL).
type ModeloRow = Omit<Modelo, 'tipos_permitidos'> & { tipos_permitidos: string | null }

function mapRow(row: ModeloRow): Modelo {
  return { ...row, tipos_permitidos: parseTipos(row.tipos_permitidos) }
}

export async function findAll(): Promise<Modelo[]> {
  const pool = await getPool()
  const r = await pool.request()
    .query(`SELECT ${COLS} FROM modelos ORDER BY marca, nombre`)
  return r.recordset.map(mapRow)
}

export async function findById(id: number): Promise<Modelo | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM modelos WHERE id = @id`)
  return r.recordset[0] ? mapRow(r.recordset[0]) : null
}

// Tipos permitidos de un modelo, para validar el alta de vehículos. Arreglo
// vacío = sin restricción (o modelo inexistente: el FK lo rechazará al insertar).
export async function findTiposPermitidos(id: number): Promise<string[]> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT tipos_permitidos FROM modelos WHERE id = @id')
  return r.recordset[0] ? parseTipos(r.recordset[0].tipos_permitidos) : []
}

export async function create(marca: string, nombre: string, anio: number | null, tiposPermitidos?: string[]): Promise<Modelo> {
  const pool = await getPool()
  const r = await pool.request()
    .input('marca',  sql.NVarChar(80),  marca)
    .input('nombre', sql.NVarChar(120), nombre)
    .input('anio',   sql.Int,           anio)
    .input('tipos',  sql.NVarChar(200), serializeTipos(tiposPermitidos))
    .query(`INSERT INTO modelos (marca, nombre, anio, tipos_permitidos) OUTPUT INSERTED.* VALUES (@marca, @nombre, @anio, @tipos)`)
  return mapRow(r.recordset[0])
}

export async function update(id: number, marca?: string, nombre?: string, anio?: number | null, tiposPermitidos?: string[]): Promise<Modelo | null> {
  const pool = await getPool()
  const sets: string[] = ['updated_at=SYSDATETIME()']
  const req = pool.request().input('id', sql.Int, id)
  if (marca  !== undefined) { req.input('marca',  sql.NVarChar(80),  marca);  sets.push('marca=@marca')   }
  if (nombre !== undefined) { req.input('nombre', sql.NVarChar(120), nombre); sets.push('nombre=@nombre') }
  if (anio   !== undefined) { req.input('anio',   sql.Int,           anio);   sets.push('anio=@anio')     }
  if (tiposPermitidos !== undefined) { req.input('tipos', sql.NVarChar(200), serializeTipos(tiposPermitidos)); sets.push('tipos_permitidos=@tipos') }
  const r = await req.query(
    `UPDATE modelos SET ${sets.join(',')} OUTPUT INSERTED.* WHERE id=@id`
  )
  return r.recordset[0] ? mapRow(r.recordset[0]) : null
}

// ¿Existe ya un modelo con la misma marca + nombre + año? (comparación
// insensible a mayúsculas por la colación por defecto de SQL Server). exceptId
// excluye el propio registro al editar.
export async function existsDuplicate(
  marca: string, nombre: string, anio: number | null, exceptId?: number
): Promise<boolean> {
  const pool = await getPool()
  const r = await pool.request()
    .input('marca',  sql.NVarChar(80),  marca)
    .input('nombre', sql.NVarChar(120), nombre)
    .input('anio',   sql.Int,           anio)
    .input('except', sql.Int,           exceptId ?? null)
    .query(`
      SELECT TOP 1 id FROM modelos
      WHERE marca = @marca AND nombre = @nombre
        AND (anio = @anio OR (anio IS NULL AND @anio IS NULL))
        AND (@except IS NULL OR id <> @except)`)
  return r.recordset.length > 0
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
