import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { COLS_ARCHIVADO, filtroArchivado, type CamposArchivado } from './archivadoRepo'

export interface Proveedor extends CamposArchivado {
  id:       number
  nombre:   string
  contacto: string | null
  // Número telefónico tal como se captura, con o sin separadores.
  telefono: string | null
}

const COLS = 'id, nombre, contacto, telefono'
const OUT  = COLS.split(', ').map((c) => `INSERTED.${c}`).join(', ') +
             ', INSERTED.archivado_en, INSERTED.archivado_motivo'
const COLS_LEER = `${COLS}, ${COLS_ARCHIVADO}`

// Por defecto solo lo que está en uso; `incluirArchivados` es para la pantalla
// del catálogo, que necesita verlos para poder restaurarlos.
export async function findAll(incluirArchivados = false): Promise<Proveedor[]> {
  const pool = await getPool()
  const filtro = filtroArchivado(incluirArchivados)
  const result = await pool.request()
    .query(`SELECT ${COLS_LEER} FROM proveedores ${filtro ? `WHERE ${filtro}` : ''} ORDER BY nombre`)
  return result.recordset
}

export async function findById(id: number): Promise<Proveedor | null> {
  const pool = await getPool()
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS_LEER} FROM proveedores WHERE id = @id`)
  return result.recordset[0] ?? null
}

export async function create(nombre: string, contacto: string | null, telefono: string | null): Promise<Proveedor> {
  const pool = await getPool()
  const result = await pool.request()
    .input('nombre',   sql.NVarChar(100), nombre)
    .input('contacto', sql.NVarChar(100), contacto ?? null)
    .input('telefono', sql.VarChar(12),   telefono ?? null)
    .query(`INSERT INTO proveedores (nombre, contacto, telefono) OUTPUT ${OUT} VALUES (@nombre, @contacto, @telefono)`)
  return result.recordset[0]
}

export async function update(id: number, nombre?: string, contacto?: string | null, telefono?: string | null): Promise<Proveedor | null> {
  const pool = await getPool()
  const sets: string[] = []
  const req = pool.request().input('id', sql.Int, id)
  if (nombre   !== undefined) { req.input('nombre',   sql.NVarChar(100), nombre);        sets.push('nombre=@nombre') }
  if (contacto !== undefined) { req.input('contacto', sql.NVarChar(100), contacto ?? null); sets.push('contacto=@contacto') }
  if (telefono !== undefined) { req.input('telefono', sql.VarChar(12),   telefono ?? null); sets.push('telefono=@telefono') }
  if (!sets.length) return findById(id)
  const result = await req.query(
    `UPDATE proveedores SET ${sets.join(',')} OUTPUT ${OUT} WHERE id=@id`
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

