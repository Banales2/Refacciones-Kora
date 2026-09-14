import * as sql from 'mssql'
import { getPool } from '../shared/db'
import { COLS_ARCHIVADO, filtroArchivado, type CamposArchivado } from './archivadoRepo'

export interface Sucursal extends CamposArchivado {
  id:        number
  nombre:    string
  ubicacion: string
}

const COLS = `id, nombre, ubicacion, ${COLS_ARCHIVADO}`
const OUT  = 'INSERTED.id, INSERTED.nombre, INSERTED.ubicacion, INSERTED.archivado_en, INSERTED.archivado_motivo'

// Por defecto solo lo que está en uso; `incluirArchivados` es para la pantalla
// del catálogo, que necesita verlos para poder restaurarlos.
export async function findAll(incluirArchivados = false): Promise<Sucursal[]> {
  const pool = await getPool()
  const filtro = filtroArchivado(incluirArchivados)
  const r = await pool.request()
    .query(`SELECT ${COLS} FROM sucursales ${filtro ? `WHERE ${filtro}` : ''} ORDER BY nombre`)
  return r.recordset
}

export async function findById(id: number): Promise<Sucursal | null> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM sucursales WHERE id = @id`)
  return r.recordset[0] ?? null
}

export async function create(nombre: string, ubicacion: string): Promise<Sucursal> {
  const pool = await getPool()
  const r = await pool.request()
    .input('nombre',    sql.NVarChar(120), nombre)
    .input('ubicacion', sql.NVarChar(200), ubicacion)
    .query(`INSERT INTO sucursales (nombre, ubicacion) OUTPUT ${OUT} VALUES (@nombre, @ubicacion)`)
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
    `UPDATE sucursales SET ${sets.join(',')} OUTPUT ${OUT} WHERE id=@id`
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

// Piezas guardadas en esta sucursal. Impiden borrarla: el FK de
// `existencias_lote` lo bloquearía de todas formas, y contarlo aquí permite
// responder con un mensaje en vez de con un error de SQL.
export async function countExistencias(id: number): Promise<number> {
  const pool = await getPool()
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT COALESCE(SUM(cantidad), 0) AS cnt FROM existencias_lote WHERE sucursal_id = @id')
  return r.recordset[0].cnt
}

